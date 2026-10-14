import type { FlowCols } from '../../types'

/** Columns kept: a Raster is at most 512 columns wide, so no graph draws more. */
export const FLOW_CAP = 512

/** Characters per token before any response has ended to learn from. */
const CPT_START = 3.6
/** The fewest characters a token is taken to cover, so streamed text never explains more tokens than this allows. */
const CPT_MIN = 1.5
const CPT_MAX = 8

/** Below this the eased rate counts as nothing, so a pause ends flat instead of on a sliver. */
const FLOOR_TPS = 0.5

/**
 * Output tokens per graph column, every response of the session counted as it streams. `cols` are the
 * closed columns, oldest first, each lasting its `ms`; `pending` fills the open one, number `seq`.
 */
export type Flow = FlowCols & { seq: number; pending: number; cpt: number }

/** One response as it streams: the characters of its text, thinking and tool input, how many are credited, and to which columns. */
export type Stream = { chars: number; counted: number; startSeq: number; credits: Map<number, number> }

export const newFlow = ({ cols, ms }: FlowCols = { cols: [], ms: [] }): Flow => {
  const n = Math.min(cols.length, ms.length, FLOW_CAP)
  return { cols: cols.slice(cols.length - n), ms: ms.slice(ms.length - n), seq: n, pending: 0, cpt: CPT_START }
}

export const flowCols = (f: Flow): FlowCols => ({ cols: f.cols.slice(), ms: f.ms.slice() })

export const newStream = (f: Flow): Stream => ({ chars: 0, counted: 0, startSeq: f.seq, credits: new Map() })

const add = (f: Flow, seq: number, tokens: number) => {
  if (seq === f.seq) f.pending = Math.max(0, f.pending + tokens)
  else {
    const i = f.cols.length - (f.seq - seq)
    if (i >= 0) f.cols[i] = Math.max(0, (f.cols[i] ?? 0) + tokens)
  }
}

/** Moves a stream's characters since the last call into the open column, as estimated tokens. */
export const credit = (f: Flow, s: Stream) => {
  const tokens = (s.chars - s.counted) / f.cpt
  if (tokens <= 0) return
  s.counted = s.chars
  f.pending += tokens
  s.credits.set(f.seq, (s.credits.get(f.seq) ?? 0) + tokens)
}

export const closeColumn = (f: Flow, ms: number) => {
  f.cols.push(f.pending)
  f.ms.push(ms)
  f.pending = 0
  f.seq += 1
  if (f.cols.length > FLOW_CAP) {
    f.cols.splice(0, f.cols.length - FLOW_CAP)
    f.ms.splice(0, f.ms.length - FLOW_CAP)
  }
}

/**
 * A response ended with its true count. What its streamed characters were credited is scaled to the share
 * they can explain, column by column, and the characters-per-token guess learns when they explain it all.
 * The rest, output the engine never streamed such as hidden thinking, spreads evenly over the columns the
 * response lasted.
 */
export const settle = (f: Flow, s: Stream, outputTokens: number | undefined) => {
  credit(f, s)
  if (!outputTokens || outputTokens <= 0) return
  const estimated = [...s.credits.values()].reduce((a, b) => a + b, 0)
  const shown = estimated > 0 ? Math.min(outputTokens, s.chars / CPT_MIN) : 0
  if (shown > 0) {
    for (const [seq, tokens] of s.credits) add(f, seq, tokens * (shown / estimated - 1))
    if (shown === outputTokens) f.cpt = Math.min(CPT_MAX, Math.max(CPT_MIN, f.cpt * 0.8 + (s.chars / outputTokens) * 0.2))
  }
  const rest = outputTokens - shown
  if (rest <= 0) return
  const first = Math.max(s.startSeq, f.seq - f.cols.length)
  const span = f.seq - first + 1
  for (let q = first; q <= f.seq; q++) add(f, q, rest / span)
}

/**
 * Tokens per second for the last `n` columns, each over its own length, oldest first, eased so a pause
 * slopes down over a few columns instead of dropping out; null where the flow has no column yet.
 */
export const flowRates = (f: FlowCols, n: number): (number | null)[] => {
  let eased = 0
  const rates = f.cols.map((t, i) => {
    eased = eased * 0.65 + ((t * 1000) / Math.max(1, f.ms[i] ?? 1)) * 0.35
    return eased < FLOOR_TPS ? 0 : eased
  })
  const shown = rates.slice(-n)
  return [...Array.from({ length: Math.max(0, n - shown.length) }, () => null), ...shown]
}
