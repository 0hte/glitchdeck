import type { HistoryEntry } from '../../types'
import { oneLine, redact } from './text'

export const HISTORY_CAP = 1000
export const PROMPT_CHARS = 160

// When the transcript splits one message over several rows it replaces the uuid's
// last group with the row index, so rows are matched on the first four groups.
const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/i

export const rowKey = (id: string) => (UUID_HEAD.test(id) ? id.slice(0, 24) : id)

/** Remembers the id a transcript row was drawn under, preferring the message's first row. */
export const keepRow = (drawn: Map<string, string>, requestId: string) => {
  const key = rowKey(requestId)
  const had = drawn.get(key)
  if (had === undefined || (requestId.length === 36 && had.length !== 36)) drawn.set(key, requestId)
}

type Block = { type?: unknown; text?: unknown }

/** The typed words of a prompt row: its first text block (hooks' context follows as further blocks). */
export const promptText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const blocks = content as Block[]
  const first = blocks.find(b => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
  if (first) return first.text as string
  return blocks.some(b => b.type === 'image') ? '[image]' : ''
}

/** Every text block of a row, for finding a prompt inside the engine's framing of it. */
export const allText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join(' ')
}

/**
 * The same list back when nothing is added, so the caller can skip the write. A prompt is taken
 * when it is submitted, with no id yet; `attachUuid` gives it the row's id once the row is kept.
 */
export const pushPrompt = (
  list: readonly HistoryEntry[],
  p: { uuid: string; text: string; at: number },
): readonly HistoryEntry[] => {
  const text = oneLine(redact(p.text))
  if (text === '' || (p.uuid !== '' && list.some(x => x.uuid === p.uuid))) return list
  const n = (list.at(-1)?.n ?? 0) + 1
  return [...list, { n, uuid: p.uuid, text: [...text].slice(0, PROMPT_CHARS).join(''), at: p.at }].slice(-HISTORY_CAP)
}

/** How a prompt is matched to its drawn row when it was read back without an id. */
export const textKey = (text: string) => [...oneLine(redact(text))].slice(0, PROMPT_CHARS).join('')

// How the engine hands the model a prompt typed mid-turn, often in the row of the next tool result.
const MID_TURN = /The user sent (?:a new )?message while you were working:\s*([\s\S]*?)(?:\n\nThis is how Claude Code surfaces|\s*<\/system-reminder>)/g

const midTurn = (text: string) => [...text.matchAll(MID_TURN)].map(m => m[1] ?? '')

/** The prompts a row carries: the row itself as typed, or each one typed mid-turn inside its framing. */
const sentIn = (r: MessageRow) => [...((r.toolResults?.length ?? 0) === 0 ? [r.text] : []), ...midTurn(r.text)]

/** A kept prompt's full text, from the session's rows; null unless exactly one distinct text matches its cut copy. */
export const originalOf = (rows: readonly MessageRow[], entry: HistoryEntry): string | null => {
  const found = new Set(rows.filter(r => r.role === 'user').flatMap(sentIn).filter(t => textKey(t) === entry.text))
  return found.size === 1 ? ([...found][0] ?? null) : null
}

/**
 * Gives the newest prompt still waiting for an id the id of the row that carries it: the row as
 * typed (`exact`), or, for one typed mid-turn, the engine's framing of it, which contains its text.
 */
export const attachUuid = (list: readonly HistoryEntry[], text: string, uuid: string, exact: boolean): readonly HistoryEntry[] => {
  if (list.some(x => x.uuid === uuid)) return list
  const key = exact ? textKey(text) : oneLine(redact(text))
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i]
    if (x && x.uuid === '' && x.text !== '' && (exact ? x.text === key : key.includes(x.text))) return list.map((y, j) => (j === i ? { ...y, uuid } : y))
  }
  return list
}

// What the engine writes as the user: its tags, an interruption, a compaction's summary.
const ENGINE_TEXT =
  /^\s*(?:<(?:task-notification|command-name|command-message|local-command-|system-reminder|bash-|user-memory-input)|\[Request interrupted by user|This session is being continued from a previous conversation|Caveat: The messages below were generated)/

type MessageRow = { role: string; text: string; toolResults?: readonly unknown[] }

/**
 * The fallback for a transcript too large to read: the session's own messages carry no id or
 * origin, so typed prompts are told apart by shape, and their rows are found by text when drawn.
 */
export const promptsFromMessages = (rows: readonly MessageRow[]): readonly HistoryEntry[] => {
  let list: readonly HistoryEntry[] = []
  for (const r of rows) {
    if (r.role !== 'user') continue
    const typed = (r.toolResults?.length ?? 0) === 0 && !ENGINE_TEXT.test(r.text) ? [r.text] : []
    for (const text of [...typed, ...midTurn(r.text)]) {
      if (!text.trim()) continue
      const n = (list.at(-1)?.n ?? 0) + 1
      list = [...list, { n, uuid: '', text: textKey(text), at: 0 }].slice(-HISTORY_CAP)
    }
  }
  return list
}

type TranscriptRow = {
  type?: unknown
  uuid?: unknown
  isSidechain?: unknown
  isMeta?: unknown
  origin?: { kind?: unknown }
  timestamp?: unknown
  message?: { content?: unknown }
  attachment?: { type?: unknown; prompt?: unknown; origin?: { kind?: unknown } }
}

/** The typed prompts of a transcript file, for a resumed session: loads are not appends. */
export const promptsFromTranscript = (jsonl: string): readonly HistoryEntry[] => {
  let list: readonly HistoryEntry[] = []
  for (const raw of jsonl.split('\n')) {
    if (!raw.includes('"human"')) continue
    let row: TranscriptRow
    try {
      row = JSON.parse(raw) as TranscriptRow
    } catch {
      continue
    }
    if (row.isSidechain === true || typeof row.uuid !== 'string') continue
    // A prompt typed mid-turn is saved as the attachment that delivered it, never as a user row.
    const queued = row.type === 'attachment' && row.attachment?.type === 'queued_command' && row.attachment.origin?.kind === 'human'
    if (!queued && (row.type !== 'user' || row.isMeta === true || row.origin?.kind !== 'human')) continue
    const text = promptText(queued ? row.attachment?.prompt : row.message?.content)
    if (queued && text.trim().startsWith('/')) continue
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : 0
    list = pushPrompt(list, { uuid: row.uuid, text, at: Number.isNaN(at) ? 0 : at })
  }
  return list
}
