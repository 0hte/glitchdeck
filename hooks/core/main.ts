import type { Activity, ActivityKind, FileTouch, LastTurn, Main, Todo, Todos, ToolRow, ToolState } from '../../types'
import { hash, oneLine, redact, shorten } from './text'

export const TOOLS_CAP = 50
export const FILES_CAP = 300
export const TODOS_CAP = 60

export const IDLE: Activity = { kind: 'idle', tool: '', target: '', since: 0 }

export const DEFAULT_MAIN: Main = {
  model: '',
  isRunning: false,
  turnStartedAt: 0,
  activity: IDLE,
  tools: [],
  flow: { cols: [], ms: [] },
  lastTurn: null,
}

export const DEFAULT_TODOS: Todos = { items: [], active: '', activeId: '' }

// ---------------------------------------------------------------- activity

export const startTurn = (m: Main, now: number): Main => ({
  ...m,
  isRunning: true,
  turnStartedAt: now,
  tools: [],
  activity: { ...IDLE, kind: 'requesting', since: now },
})

export const endTurn = (m: Main, now: number, t: { durationMs: number; reason: string }): Main => {
  const lastTurn: LastTurn = {
    durationMs: t.durationMs,
    tools: m.tools.length,
    errors: m.tools.filter(r => r.state === 'err').length,
    reason: t.reason,
    endedAt: now,
  }
  return { ...m, isRunning: false, activity: { ...IDLE, since: now }, lastTurn }
}

/** A step's chunk kind as the activity it shows; undefined keeps the current one. */
export const kindOfChunk = (kind: string): ActivityKind | undefined =>
  kind === 'thinking' ? 'thinking' : kind === 'text' ? 'responding' : kind === 'tool' ? 'tool-input' : undefined

export const setActivity = (m: Main, a: Omit<Activity, 'since'>, now: number): Main =>
  m.activity.kind === a.kind && m.activity.tool === a.tool && m.activity.target === a.target
    ? m
    : { ...m, activity: { ...a, since: now } }

// ---------------------------------------------------------------- tools

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A path as its last two segments. */
export const shortPath = (p: string) => oneLine(p).split(/[\\/]/).filter(Boolean).slice(-2).join('/')

/** What a call is about, in one redacted line: its command, path, pattern, url or description. */
export const targetOf = (tool: string, input: unknown): string => {
  const i = isObject(input) ? input : {}
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const path = str('file_path') || str('notebook_path') || str('path')
  const raw =
    tool === 'Bash' || tool === 'PowerShell'
      ? str('command')
      : tool === 'Grep' || tool === 'Glob'
        ? str('pattern')
        : tool === 'WebFetch'
          ? str('url')
          : tool === 'WebSearch' || tool === 'ToolSearch'
            ? str('query')
            : path
              ? shortPath(path)
              : str('description') || str('subject') || str('prompt') || str('skill') || str('query')
  return shorten(redact(oneLine(raw)), 120)
}

/** The calls MAIN draws above the finished ones: those still running, while the turn is. */
export const runningCalls = (m: Main) => (m.isRunning ? m.tools.filter(r => r.state === 'run') : [])

export const startTool = (m: Main, row: Omit<ToolRow, 'state' | 'ms'>): Main => {
  const tool = shorten(row.tool, 40)
  return {
    ...m,
    tools: [...m.tools, { ...row, tool, state: 'run' as const, ms: null }].slice(-TOOLS_CAP),
    activity: { kind: 'tool-use', tool, target: row.target, since: row.startedAt },
  }
}

/** Calls run in parallel: the header follows the newest call still running, then waits for the model. */
export const endTool = (m: Main, id: string, state: ToolState, now: number): Main => {
  const tools = m.tools.map(r => (r.id === id ? { ...r, state, ms: now - r.startedAt } : r))
  if (m.activity.kind !== 'tool-use') return { ...m, tools }
  const running = tools.filter(r => r.state === 'run').at(-1)
  const activity = running
    ? { kind: 'tool-use' as const, tool: running.tool, target: running.target, since: running.startedAt }
    : { ...IDLE, kind: 'requesting' as const, since: now }
  return { ...m, tools, activity }
}

// ---------------------------------------------------------------- todos

type TodoInput = { content?: unknown; status?: unknown; activeForm?: unknown }

const asStatus = (s: unknown): Todo['status'] =>
  s === 'in_progress' || s === 'completed' ? s : 'pending'

/** TodoWrite replaces the whole list. */
export const todosFromWrite = (todos: unknown): Todos => {
  const list = Array.isArray(todos) ? (todos as TodoInput[]) : []
  const items = list.slice(0, TODOS_CAP).map((t, i) => ({
    id: String(i),
    text: shorten(redact(String(t.content ?? '')), 120),
    status: asStatus(t.status),
  }))
  const at = list.findIndex(t => t.status === 'in_progress')
  const current = list[at]
  const words = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    items,
    active: current ? shorten(redact(words(current.activeForm) || words(current.content)), 120) : '',
    activeId: current ? String(at) : '',
  }
}

export const todoCreated = (t: Todos, task: { id: string; subject: string }): Todos =>
  t.items.some(x => x.id === task.id)
    ? t
    : { ...t, items: [...t.items, { id: task.id, text: shorten(redact(task.subject), 120), status: 'pending' as const }].slice(-TODOS_CAP) }

export const todoUpdated = (t: Todos, u: { taskId: string; status?: string; subject?: string; activeForm?: string }): Todos => {
  if (u.status === 'deleted')
    return t.activeId === u.taskId ? { items: t.items.filter(x => x.id !== u.taskId), active: '', activeId: '' } : { ...t, items: t.items.filter(x => x.id !== u.taskId) }
  const items = t.items.map(x =>
    x.id === u.taskId
      ? { ...x, status: u.status ? asStatus(u.status) : x.status, text: u.subject ? shorten(redact(u.subject), 120) : x.text }
      : x,
  )
  const item = items.find(x => x.id === u.taskId)
  if (u.status === 'in_progress') return { items, active: shorten(redact(u.activeForm || item?.text || ''), 120), activeId: u.taskId }
  if (u.status === 'completed' && t.activeId === u.taskId) return { items, active: '', activeId: '' }
  return { ...t, items }
}

// ---------------------------------------------------------------- files

export const READ_TOOLS = new Set(['Read'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** A file as its key and its drawn name: two files of one name in different folders stay two. */
export const fileOf = (full: string) => {
  const p = oneLine(full).replace(/\\/g, '/')
  return { key: hash(p).toString(36), path: redact(shortPath(p)) }
}

export const touchFile = (list: readonly FileTouch[], file: { key: string; path: string }, isEdit: boolean, now: number): FileTouch[] => {
  const had = list.find(f => f.key === file.key)
  const next: FileTouch = {
    key: file.key,
    path: file.path,
    reads: (had?.reads ?? 0) + (isEdit ? 0 : 1),
    edits: (had?.edits ?? 0) + (isEdit ? 1 : 0),
    at: now,
  }
  return [...list.filter(f => f.key !== file.key), next].slice(-FILES_CAP)
}
