// Every row count the pane draws is decided here, so the sections always add up to the room the pane
// has. These constants describe the shapes the views draw; a test holds a drawn pane to `height`.

import type { Collapsed } from '../../types'

/** A section's header and the blank row under it. */
export const HEAD = 2
/** The blank row between sections. */
export const GAP = 1
/** The throughput graph's rows. */
export const GRAPH_ROWS = 3
/** The throughput graph and the blank row under it. */
export const GRAPH_H = GRAPH_ROWS + 1
/** The opened process without its body: task, numbers, a blank, two rows of its last words. A body adds a blank above it. */
export const DETAIL_BASE = 5

const MAX_PAST_ROWS = 12
const MAX_ITEMS = 12
const MAX_LIST_ROWS = 40
const MAX_DETAIL_ROWS = 15
const MAX_HIST_ROWS = 12

export type LayoutInput = {
  rows: number
  /** `now`: rows of what runs right now, or the last turn's receipt; `past`: finished calls of the turn. */
  main: { now: number; past: number; hasTodo: boolean; hasActive: boolean; hasGraph: boolean }
  /** Each top-level process's height, in drawing order; the opened one's body rows; whether all are listed. */
  procs: { items: readonly number[]; detail: number | null; isList: boolean } | null
  history: number
  /** Sections folded to their header: each takes that one row and gives the rest of its room away. */
  collapsed?: Collapsed
}

export type Layout = {
  pastRows: number
  showGraph: boolean
  showTodo: boolean
  showFiles: boolean
  procMode: 'none' | 'items' | 'list' | 'detail'
  /** Top-level processes the short list shows. */
  procItems: number
  listRows: number
  detailRows: number
  histRows: number
  /** What the pane takes with these counts; more than `rows` only when even the minimums don't fit. */
  height: number
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * Minimums first (what runs now, two processes, two prompts), then the room left goes to what reads
 * best, in order: todo and files, a few finished calls, the graph, more history, the opened process,
 * more processes, more calls, then everything else up to its cap.
 */
export const layout = (input: LayoutInput): Layout => {
  const { main, procs, history } = input
  const folded = input.collapsed ?? {}
  const items = procs?.items ?? []
  const l: Layout = {
    pastRows: 0,
    showGraph: false,
    showTodo: false,
    showFiles: false,
    procMode: procs === null ? 'none' : procs.detail !== null ? 'detail' : procs.isList ? 'list' : 'items',
    procItems: 0,
    listRows: 0,
    detailRows: procs?.detail != null ? Math.min(procs.detail, 1) : 0,
    histRows: Math.min(history, 1),
    height: 0,
  }
  // With no room for anything under it, main is its header alone.
  const mainH = () => {
    if (folded.main) return 1
    // A blank parts the extras from the rows above them, when there are any.
    const extras = l.showTodo || l.showFiles ? Number(main.now + l.pastRows > 0) + (l.showTodo ? 1 + Number(main.hasActive) : 0) + Number(l.showFiles) : 0
    const body = main.now + l.pastRows + (l.showGraph ? GRAPH_H : 0) + extras
    return body === 0 ? 1 : HEAD + body
  }
  const procsH = () => {
    if (l.procMode === 'none') return 0
    if (folded.procs) return GAP + 1
    if (l.procMode === 'detail') return GAP + HEAD + DETAIL_BASE + (l.detailRows > 0 ? 1 + l.detailRows : 0)
    // The full list ends on its way back; the short one on `+N more` when it hides some.
    if (l.procMode === 'list') return GAP + HEAD + l.listRows + 1
    return GAP + HEAD + sum(items.slice(0, l.procItems)) + (l.procItems < items.length ? 1 : 0)
  }
  const histH = () => (history === 0 ? 0 : folded.history ? GAP + 1 : GAP + HEAD + l.histRows)
  const used = () => mainH() + procsH() + histH()
  const fits = (change: () => void) => {
    const before = { ...l }
    change()
    if (used() > input.rows) Object.assign(l, before)
  }
  const grow = (key: 'pastRows' | 'procItems' | 'listRows' | 'detailRows' | 'histRows', upTo: number) => {
    for (let i = l[key]; i < upTo; i++) fits(() => (l[key] += 1))
  }

  if (l.procMode === 'items') grow('procItems', Math.min(items.length, 2))
  if (l.procMode === 'list') grow('listRows', Math.min(items.length, 3))
  grow('detailRows', Math.min(procs?.detail ?? 0, 3))
  grow('histRows', Math.min(history, 2))
  if (main.hasTodo) fits(() => (l.showTodo = true))
  fits(() => (l.showFiles = true))
  grow('pastRows', Math.min(main.past, 3))
  if (main.hasGraph) fits(() => (l.showGraph = true))
  grow('histRows', Math.min(history, 5))
  grow('detailRows', Math.min(procs?.detail ?? 0, MAX_DETAIL_ROWS))
  if (l.procMode === 'items') grow('procItems', Math.min(items.length, MAX_ITEMS))
  if (l.procMode === 'list') grow('listRows', Math.min(items.length, MAX_LIST_ROWS))
  grow('pastRows', Math.min(main.past, 6))
  grow('pastRows', Math.min(main.past, MAX_PAST_ROWS))
  grow('histRows', Math.min(history, MAX_HIST_ROWS))
  // A folded section's counts cost nothing above, so they grew freely: nothing of them is drawn.
  if (folded.main) Object.assign(l, { pastRows: 0, showGraph: false, showTodo: false, showFiles: false })
  if (folded.procs) Object.assign(l, { procItems: 0, listRows: 0, detailRows: 0 })
  if (folded.history) l.histRows = 0
  l.height = used()
  return l
}
