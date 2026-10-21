import type { Proc, ProcKind, ProcState, Timeline, ToolRow, ToolState } from '../../types'
import { oneLine, redact, shorten } from './text'

export const PROCS_CAP = 80
export const CALLS_CAP = 40
export const TEXT_CAP = 300
/** A live workflow's agents the short list shows under it; the rest fold into one line. */
export const KIDS_SHOWN = 3

export const isLive = (p: Proc) => p.state === 'R' || p.state === 'S'

/** `voltagent-qa-sec:code-reviewer` → `code-reviewer`. */
export const shortType = (t: string) => t.split(':').pop() || t

export const newProc = (p: {
  id: string
  kind: ProcKind
  type: string
  task: string
  now: number
  taskId?: string
  parent?: string
  endsWithParent?: boolean
  isBackground?: boolean
}): Proc => ({
  id: p.id,
  taskId: p.taskId ?? p.id,
  isBackground: p.isBackground,
  kind: p.kind,
  parent: p.parent ?? '',
  type: shorten(p.type, 40),
  task: shorten(redact(oneLine(p.task)), 160),
  state: 'R',
  why: '',
  startedAt: p.now,
  endedAt: null,
  changedAt: p.now,
  tokOut: 0,
  ctx: 0,
  steps: 0,
  lastText: '',
  endsWithParent: p.endsWithParent ?? false,
})

/** Adds or refreshes a process; past the cap the oldest finished ones go first, then the oldest live ones. */
export const addProc = (list: readonly Proc[], p: Proc): readonly Proc[] => {
  const had = list.find(x => x.id === p.id)
  const merged = had ? list.map(x => (x.id === p.id ? { ...p, startedAt: x.startedAt } : x)) : [...list, p]
  const over = merged.length - PROCS_CAP
  if (over <= 0) return merged
  const oldest = merged
    .filter(x => x.id !== p.id)
    .sort((a, b) => Number(isLive(a)) - Number(isLive(b)) || (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))
  const gone = new Set(oldest.slice(0, over).map(x => x.id))
  return merged.filter(x => !gone.has(x.id))
}

const edit = (list: readonly Proc[], id: string, change: (p: Proc) => Proc): readonly Proc[] => {
  const p = list.find(x => x.id === id || x.taskId === id)
  if (!p) return list
  const next = change(p)
  return next === p ? list : list.map(x => (x === p ? next : x))
}

export const setState = (list: readonly Proc[], id: string, state: ProcState, why: string, now: number): readonly Proc[] =>
  edit(list, id, p =>
    p.state === state && p.why === why
      ? p
      : { ...p, state, why, changedAt: now, endedAt: state === 'X' || state === 'Z' ? (p.endedAt ?? now) : null },
  )

type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** One model request of an agent: its tokens, its words, and it is running again. */
export const applyStep = (
  list: readonly Proc[],
  id: string,
  s: { usage: StepUsage | null; answer: string; now: number },
): readonly Proc[] =>
  edit(list, id, p => ({
    ...p,
    state: 'R',
    why: '',
    endedAt: null,
    changedAt: p.state === 'R' ? p.changedAt : s.now,
    steps: p.steps + 1,
    tokOut: p.tokOut + (s.usage?.output_tokens ?? 0),
    ctx: s.usage ? s.usage.input_tokens + s.usage.cache_read_input_tokens + s.usage.cache_creation_input_tokens : p.ctx,
    lastText: s.answer.trim() ? shorten(redact(oneLine(s.answer)), TEXT_CAP) : p.lastText,
  }))

/** The background commands an agent's final answer ends: no notification follows them. */
export const endChildren = (list: readonly Proc[], parent: string, now: number): readonly Proc[] =>
  list.filter(p => p.parent === parent && p.endsWithParent && isLive(p)).reduce((acc, p) => setState(acc, p.id, 'X', '', now), list)

// ---------------------------------------------------------------- timelines

/** Calls made in all; a value kept before the count existed has only its calls. */
export const totalOf = (t: Timeline | undefined) => t?.total ?? t?.calls.length ?? 0

export const startCall = (t: Timeline | undefined, row: Omit<ToolRow, 'state' | 'ms'>): Timeline => ({
  calls: [...(t?.calls ?? []), { ...row, tool: shorten(row.tool, 40), state: 'run' as const, ms: null }].slice(-CALLS_CAP),
  total: totalOf(t) + 1,
})

export const endCall = (t: Timeline | undefined, callId: string, state: ToolState, now: number): Timeline => ({
  calls: (t?.calls ?? []).map(c => (c.id === callId ? { ...c, state, ms: now - c.startedAt } : c)),
  total: totalOf(t),
})

type Summary = { toolUses: readonly { tool_use_id: string; tool: string; input: unknown }[]; toolResults?: readonly { tool_use_id: string; isError: boolean }[] }

/**
 * Calls read back from an agent's conversation, for one that ran before the mod loaded: each one
 * settled by its result, still running while the agent is, cut off when it ended without one.
 */
export const callsFromMessages = (rows: readonly Summary[], isAgentLive: boolean, targetOf: (tool: string, input: unknown) => string): ToolRow[] => {
  const results = new Map<string, boolean>()
  for (const r of rows) for (const x of r.toolResults ?? []) results.set(x.tool_use_id, x.isError)
  return rows
    .flatMap(r => r.toolUses)
    .map(u => {
      const isError = results.get(u.tool_use_id)
      const state: ToolState = isError === undefined ? (isAgentLive ? 'run' : 'err') : isError ? 'err' : 'ok'
      return { id: u.tool_use_id, tool: shorten(u.tool, 40), target: targetOf(u.tool, u.input), state, startedAt: 0, ms: null }
    })
}

/** The calls read back, under the ones seen live (which know their times), and the count of both. */
export const withBackfill = (t: Timeline | undefined, back: readonly ToolRow[]): Timeline => {
  const seen = t?.calls ?? []
  const seenIds = new Set(seen.map(c => c.id))
  const backIds = new Set(back.map(c => c.id))
  const total = back.length + seen.filter(c => !backIds.has(c.id)).length
  return { calls: [...back.filter(c => !seenIds.has(c.id)), ...seen].slice(-CALLS_CAP), total: Math.max(total, totalOf(t)) }
}

// ---------------------------------------------------------------- endings

export type Ending = { taskId: string; state: ProcState; why: string }

const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim()

/**
 * A background task's notification, as the transcript holds it:
 * `<task-id>…</task-id> … <status>completed|failed|killed</status> <summary>… (exit code N)</summary>`.
 * A Monitor's output lines arrive the same way with no status: those end nothing.
 */
export const endingOf = (text: string): Ending | null => {
  if (!text.includes('<task-notification>')) return null
  const taskId = tag(text, 'task-id')
  const status = tag(text, 'status')
  if (!taskId || !status) return null
  const code = /exit code (\d+)/.exec(tag(text, 'summary') ?? '')?.[1]
  if (status === 'completed') return code && code !== '0' ? { taskId, state: 'Z', why: `exit ${code}` } : { taskId, state: 'X', why: '' }
  if (status === 'killed' || status === 'stopped') return { taskId, state: 'Z', why: 'killed' }
  if (status === 'failed') return { taskId, state: 'Z', why: code ? `exit ${code}` : 'failed' }
  return null
}

/** `$.agent.list()`'s status as a process state; undefined leaves the process as it is. */
export const stateOfStatus = (status: string): ProcState | undefined =>
  status === 'running'
    ? 'R'
    : status === 'pending' || status === 'waiting' || status === 'idle'
      ? 'S'
      : status === 'completed'
        ? 'X'
        : status === 'failed' || status === 'killed'
          ? 'Z'
          : undefined

type Listed = { id: string; status: string; type: string; description: string; parentId?: string }

/**
 * `$.agent.list()` folded in: an agent not seen yet is added while it runs, a known one follows its
 * status. The list is read before it is applied, so it never brings back an agent that ended meanwhile;
 * one that works again says so with its next step.
 */
export const applyList = (list: readonly Proc[], agents: readonly Listed[], now: number): readonly Proc[] => {
  let acc = list
  for (const a of agents) {
    const state = stateOfStatus(a.status)
    if (!state) continue
    const known = acc.find(p => p.id === a.id)
    if (known) {
      const isRevival = !isLive(known) && (state === 'R' || state === 'S')
      if (known.kind === 'agent' && known.state !== state && !isRevival) acc = setState(acc, a.id, state, state === 'Z' ? a.status : known.why, now)
    } else if (state === 'R' || state === 'S')
      acc = addProc(acc, { ...newProc({ id: a.id, kind: 'agent', type: shortType(a.type), task: a.description, now, parent: a.parentId }), state })
  }
  return acc
}

/**
 * At a turn's stop the engine lists the background work still in flight, its agents' commands
 * included: live work missing there has ended, even when its notification reached no hook. A nested
 * agent is left alone, since a foreground one is never listed; a workflow's agents end with their run.
 */
export const endMissing = (list: readonly Proc[], inFlight: ReadonlySet<string>, now: number): readonly Proc[] => {
  const isListed = (p: Proc) => p.kind === 'shell' || p.kind === 'monitor' || p.kind === 'workflow' || (p.kind === 'agent' && p.parent === '')
  const gone = list.filter(p => isLive(p) && isListed(p) && !inFlight.has(p.id) && !inFlight.has(p.taskId))
  return gone.reduce((acc, p) => setState(acc, p.id, 'X', '', now), list)
}

export const turnEnding = (reason: string): { state: ProcState; why: string } =>
  reason === 'answer' ? { state: 'X', why: '' } : reason === 'aborted' ? { state: 'Z', why: 'stopped' } : { state: 'Z', why: reason }

// ---------------------------------------------------------------- display

/** Live ones by start (so rows don't move), then the newest endings. */
const ordered = (list: readonly Proc[]): Proc[] => {
  const live = list.filter(isLive).sort((a, b) => a.startedAt - b.startedAt)
  const done = list.filter(p => !isLive(p)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return [...live, ...done]
}

/** Top-level processes in drawing order; a workflow's agents stay inside their workflow. */
export const topLevel = (list: readonly Proc[]): Proc[] => ordered(list.filter(p => p.kind !== 'wfagent'))

export const childrenOf = (list: readonly Proc[], id: string) => ordered(list.filter(p => p.parent === id))

/** The agents a live workflow shows under it in the short list, and how many fold into `+N more`. */
export const shownKids = (list: readonly Proc[], id: string) => {
  const kids = childrenOf(list, id)
  return { shown: kids.slice(0, KIDS_SHOWN), hidden: Math.max(0, kids.length - KIDS_SHOWN) }
}

/** Rows a top-level process takes: a live agent adds a line when it has something to say, a live workflow its agents. */
export const itemHeight = (p: Proc, list: readonly Proc[], hasSecondLine: boolean) => {
  if (!isLive(p)) return 1
  if (p.kind === 'workflow') {
    const k = shownKids(list, p.id)
    return 1 + k.shown.length + (k.hidden > 0 ? 1 : 0)
  }
  return p.kind === 'agent' && hasSecondLine ? 2 : 1
}

/** How many rows the opened process's body has: its calls, or a workflow's agents. */
export const detailItems = (p: Proc, list: readonly Proc[], calls: readonly ToolRow[]) =>
  p.kind === 'workflow' ? childrenOf(list, p.id).length : calls.length

/** `840`, `8.1k`, `31k`, `1.2M`. */
export const kTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}k`
      : n >= 1000
        ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
        : String(n)
