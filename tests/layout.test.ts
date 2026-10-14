import { expect, test } from 'claude-code/testing'

import { layout } from '../hooks/core/layout'
import type { LayoutInput } from '../hooks/core/layout'

const busy = (rows: number, over: Partial<LayoutInput> = {}): LayoutInput => ({
  rows,
  main: { now: 1, past: 10, hasTodo: true, hasActive: true, hasFiles: true, hasGraph: true },
  procs: { items: [2, 2, 3, 1, 1], detail: null, isList: false },
  history: 20,
  ...over,
})

test('the sections always add up to the room the pane has', () => {
  for (const rows of [24, 30, 40, 50, 70]) {
    for (const input of [
      busy(rows),
      busy(rows, { procs: null }),
      busy(rows, { procs: { items: [2, 2, 3, 1, 1], detail: 12, isList: false } }),
      busy(rows, { procs: { items: [1, 1, 1, 1, 1], detail: null, isList: true } }),
      busy(rows, { history: 0 }),
    ]) {
      expect(layout(input).height).toBeLessThanOrEqual(rows)
    }
  }
})

test('at 40 rows everything has a place: the graph, some calls, the processes and history', () => {
  const l = layout(busy(40))
  expect(l.showGraph).toBe(true)
  expect(l.pastRows).toBeGreaterThan(0)
  expect(l.procItems).toBeGreaterThanOrEqual(2)
  expect(l.histRows).toBeGreaterThanOrEqual(2)
})

test('a short pane keeps two processes and two prompts before the extras', () => {
  const l = layout(busy(20))
  expect(l.procItems).toBe(2)
  expect(l.histRows).toBe(2)
  expect(l.showGraph).toBe(false)
})

test('processes are shown in order, a tall one never skipped for a shorter one after it', () => {
  const l = layout(busy(16, { main: { now: 1, past: 0, hasTodo: false, hasActive: false, hasFiles: false, hasGraph: false }, procs: { items: [2, 9, 1], detail: null, isList: false }, history: 0 }))
  expect(l.procItems).toBe(1)
})

test('the full list has room for every process when there is', () => {
  const l = layout(busy(80, { procs: { items: Array.from({ length: 30 }, () => 1), detail: null, isList: true } }))
  expect(l.procMode).toBe('list')
  expect(l.listRows).toBe(30)
  expect(l.height).toBeLessThanOrEqual(80)
})

test('spare room goes to calls and history, up to what there is', () => {
  const l = layout(busy(200))
  expect(l.pastRows).toBe(10)
  expect(l.histRows).toBe(12)
  expect(layout(busy(200, { history: 3 })).histRows).toBe(3)
})

test('with nothing to show yet, main is its header alone', () => {
  const quiet = { now: 0, past: 0, hasTodo: false, hasActive: false, hasFiles: false, hasGraph: false }
  expect(layout({ rows: 30, main: quiet, procs: null, history: 0 }).height).toBe(1)
  // One prompt: the header, then the gap, the prompts' header and blank, and the row.
  expect(layout({ rows: 30, main: quiet, procs: null, history: 1 }).height).toBe(5)
})

test('an opened process with no calls yet takes no body rows', () => {
  const l = layout(busy(40, { procs: { items: [1], detail: 0, isList: false } }))
  expect(l.procMode).toBe('detail')
  expect(l.detailRows).toBe(0)
})
