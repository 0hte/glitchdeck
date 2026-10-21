import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fmtClock, fmtMs, prettyModel } from '../hooks/core/fmt'
import { closeColumn, credit, flowRates, newFlow, newStream, settle } from '../hooks/core/flow'
import { areaCells, brailleRows, columnMs, encodeCells } from '../hooks/core/graph'
import {
  DEFAULT_MAIN,
  DEFAULT_TODOS,
  endTool,
  endTurn,
  setActivity,
  startTool,
  startTurn,
  targetOf,
  todoCreated,
  todoUpdated,
  todosFromWrite,
} from '../hooks/core/main'
import { effectsOf } from '../hooks/core/effects'
import { CREATED, DELETED, EDITED, READ, countFiles, deletedPaths, internalRoots, isInternal, markFile, normalPath } from '../hooks/core/files'
import { pane } from './kit'

// ---------------------------------------------------------------- pure behavior

test('a turn records each tool call and summarizes when it ends', () => {
  let m = startTurn(DEFAULT_MAIN, 1000)
  m = startTool(m, { id: 't1', tool: 'Bash', target: 'npm test', startedAt: 1100 })
  expect(m.activity.kind).toBe('tool-use')
  m = endTool(m, 't1', 'err', 1600)
  expect(m.activity.kind).toBe('requesting')
  expect(m.tools[0]).toMatchObject({ state: 'err', ms: 500 })
  m = endTurn(m, 2000, { durationMs: 1000, reason: 'answer' })
  expect(m.isRunning).toBe(false)
  expect(m.lastTurn).toEqual({ durationMs: 1000, tools: 1, errors: 1, reason: 'answer', endedAt: 2000 })
})

test('parallel calls keep the header on the call still running', () => {
  let m = startTurn(DEFAULT_MAIN, 0)
  m = startTool(m, { id: 'a', tool: 'Read', target: 'a.ts', startedAt: 1 })
  m = startTool(m, { id: 'b', tool: 'Grep', target: 'todo', startedAt: 2 })
  m = startTool(m, { id: 'c', tool: 'Read', target: 'c.ts', startedAt: 3 })
  m = endTool(m, 'c', 'ok', 10)
  expect(m.activity).toMatchObject({ kind: 'tool-use', tool: 'Grep', target: 'todo' })
  m = endTool(m, 'b', 'ok', 11)
  expect(m.activity).toMatchObject({ kind: 'tool-use', tool: 'Read', target: 'a.ts' })
  m = endTool(m, 'a', 'ok', 12)
  expect(m.activity.kind).toBe('requesting')
  expect(setActivity(m, { kind: 'requesting', tool: '', target: '' }, 99)).toBe(m)
})

test('a turn carries the id that can end it, and drops it when it ends', () => {
  let m = startTurn(DEFAULT_MAIN, 1000, 'T1')
  expect(m.turnId).toBe('T1')
  m = endTurn(m, 2000, { durationMs: 1000, reason: 'answer' })
  expect(m.turnId).toBe('')
})

test('targets are one redacted line', () => {
  expect(targetOf('Bash', { command: 'curl -H "Authorization: Bearer abcdefgh12345"\n api' })).not.toContain('abcdefgh')
  expect(targetOf('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('src/main.ts')
  expect(targetOf('Grep', { pattern: 'ui.scroll' })).toBe('ui.scroll')
})

test('todos follow TodoWrite and the task tools', () => {
  const w = todosFromWrite([
    { content: 'a', status: 'completed', activeForm: 'Doing a' },
    { content: 'b', status: 'in_progress', activeForm: 'Doing b' },
  ])
  expect(w.items.map(t => t.status)).toEqual(['completed', 'in_progress'])
  expect(w.active).toBe('Doing b')
  let t = todoCreated(DEFAULT_TODOS, { id: '7', subject: 'ship it' })
  t = todoUpdated(t, { taskId: '7', status: 'in_progress', activeForm: 'Shipping it' })
  expect(t.active).toBe('Shipping it')
  t = todoUpdated(t, { taskId: '7', status: 'deleted' })
  expect(t.items).toEqual([])
})

test('files are counted once each, and a file the session made counts as created, not edited', () => {
  let m = markFile({}, 'a', READ)
  m = markFile(m, 'a', EDITED)
  m = markFile(m, 'b', CREATED)
  m = markFile(m, 'b', EDITED)
  m = markFile(m, 'c', DELETED)
  expect(markFile(m, 'a', READ)).toBe(m)
  expect(countFiles(m)).toEqual({ read: 1, edited: 1, created: 1, deleted: 1 })
})

test('the paths a shell command deletes are read from its words', () => {
  expect(deletedPaths('rm -rf dist build/cache && npm run build', false)).toEqual(['dist', 'build/cache'])
  expect(deletedPaths('sudo rm "my file.txt" 2>/dev/null; unlink old.log', false)).toEqual(['my file.txt', 'old.log'])
  expect(deletedPaths('git rm src/a.ts && git rm --cached src/b.ts', false)).toEqual(['src/a.ts'])
  expect(deletedPaths('Remove-Item -Path out.txt -Force; del -Filter *.tmp notes.md', true)).toEqual(['out.txt', 'notes.md'])
  expect(deletedPaths('echo rm is not run here && ls', false)).toEqual([])
})

test("Claude's own folders are left out, and paths are compared as the system compares them", () => {
  const bs = String.fromCharCode(92)
  const roots = internalRoots({ USERPROFILE: 'C:/Users/me', TEMP: 'C:/Users/me/AppData/Local/Temp' })
  const place = { cwd: 'C:/repo', home: 'C:/Users/me' }
  expect(isInternal(normalPath('C:/Users/me/AppData/Local/Temp/claude/x/scratchpad/a.md', place), roots)).toBe(true)
  expect(isInternal(normalPath(['C:', 'Users', 'ME', '.claude', 'plans', 'p.md'].join(bs), place), roots)).toBe(true)
  expect(isInternal(normalPath('~/.claude/settings.json', place), roots)).toBe(true)
  // A project's own `.claude` folder is the project's.
  expect(isInternal(normalPath('.claude/settings.json', place), roots)).toBe(false)
  expect(normalPath('src/../src/./a.ts', place)).toBe(normalPath('C:/REPO/src/a.ts', place))
})

test("a file call says what it did to its file, a shell command what it deleted, and Claude's own files count for nothing", () => {
  const place = { cwd: '/repo', home: '/home/me', roots: internalRoots({ HOME: '/home/me', TMPDIR: '/tmp' }) }
  const marks = (tool: string, input: object, result: object = {}) =>
    effectsOf({ tool, input, result, now: 0, place }).flatMap(x => (x.kind === 'file' ? [x.mark] : []))
  expect(marks('Read', { file_path: '/repo/a.ts' })).toEqual([READ])
  expect(marks('Write', { file_path: '/repo/new.ts' }, { type: 'create' })).toEqual([CREATED])
  expect(marks('Write', { file_path: '/repo/a.ts' }, { type: 'update' })).toEqual([EDITED])
  expect(marks('Edit', { file_path: '/repo/b.ts' }, { originalFile: null })).toEqual([CREATED])
  expect(marks('Edit', { file_path: '/repo/a.ts' }, { originalFile: 'x' })).toEqual([EDITED])
  expect(marks('Bash', { command: 'rm a.ts b.ts' })).toEqual([DELETED, DELETED])
  // Sent to the background, the command has not run when its call answers.
  expect(marks('Bash', { command: 'rm a.ts', run_in_background: true }, { backgroundTaskId: 'b1' })).toEqual([])
  expect(marks('Write', { file_path: '/home/me/.claude/plans/p.md' }, { type: 'create' })).toEqual([])
  expect(marks('Write', { file_path: '/tmp/claude/s/scratchpad/n.md' }, { type: 'create' })).toEqual([])
  expect(effectsOf({ tool: 'Read', input: { file_path: '/repo/a.ts' }, result: {}, agentId: 'ag1', now: 0, place })).toEqual([])
})

test('formatting', () => {
  expect([fmtMs(400), fmtMs(12_000), fmtMs(187_000)]).toEqual(['0.4s', '12s', '3:07'])
  expect([fmtClock(42_000), fmtClock(725_000), fmtClock(3_900_000)]).toEqual(['0:42', '12:05', '1h05'])
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
})

test('streamed text is credited as it arrives, then scaled to the true count when the response ends', () => {
  const f = newFlow()
  const s = newStream(f)
  s.chars = 360
  credit(f, s)
  closeColumn(f, 1000)
  s.chars = 720
  credit(f, s)
  closeColumn(f, 1000)
  // 3.6 characters a token until a response has ended: 100 estimated tokens a column.
  expect(f.cols).toEqual([100, 100])
  settle(f, s, 150)
  expect(f.cols.map(Math.round)).toEqual([75, 75])
  expect(Math.round(f.cpt * 1000)).toBe(Math.round((3.6 * 0.8 + (720 / 150) * 0.2) * 1000))
})

test('a response that showed nothing spreads its count over the columns it lasted', () => {
  const f = newFlow({ cols: [7], ms: [1000] })
  const s = newStream(f)
  closeColumn(f, 1000)
  settle(f, s, 300)
  expect(f.cols[0]).toBe(7)
  expect(f.cols[1]).toBe(150)
  expect(f.pending).toBe(150)
})

test('what the streamed text cannot explain, such as hidden thinking, spreads over the response instead of piling on the text', () => {
  const f = newFlow()
  const s = newStream(f)
  for (let i = 0; i < 9; i++) closeColumn(f, 1000)
  s.chars = 30
  credit(f, s)
  closeColumn(f, 1000)
  settle(f, s, 2000)
  // 30 characters explain at most 20 tokens; the other 1980 share the 11 columns the response touched.
  expect(f.cols.map(Math.round)).toEqual([180, 180, 180, 180, 180, 180, 180, 180, 180, 200])
  expect(Math.round(f.pending)).toBe(180)
  expect(f.cpt).toBe(3.6)
})

test('the graph eases a pause down over a few columns and pads the oldest side', () => {
  expect(columnMs(52)).toBe(1154)
  const eased = flowRates({ cols: [10, 0, 0, 0, 0, 0, 0], ms: Array(7).fill(1000) }, 9).map(v => (v === null ? null : Math.round(v * 10) / 10))
  expect(eased).toEqual([null, null, 3.5, 2.3, 1.5, 1, 0.6, 0, 0])
})

test('each column is read over its own length, so a resize does not rescale what came before', () => {
  expect(flowRates({ cols: [5, 10], ms: [500, 1000] }, 2)).toEqual(flowRates({ cols: [10, 10], ms: [1000, 1000] }, 2))
})

test('the graph is an area in eighths of a cell, every value above zero at least one eighth high', () => {
  const cells = areaCells([null, 0, 4, 8, 0.1], 1, () => '#ffffff')
  expect([cells[0], cells[3], cells[6], cells[9], cells[12]]).toEqual([0x20, 0x20, 0x2584, 0x2588, 0x2581])
  // Two rows: six eighths of sixteen fill most of the lower cell and leave the upper one empty.
  const two = areaCells([6, 16], 2, () => '#ffffff')
  expect([two[0], two[6], two[3], two[9]]).toEqual([0x20, 0x2586, 0x2588, 0x2588])
  expect(encodeCells(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
  expect(encodeCells(Uint32Array.of(1))).toBe('AQAAAA==')
  expect(brailleRows([null, 4], 1)).toEqual(['⢸'])
})

// ---------------------------------------------------------------- through the engine

const engine = (on: On) => {
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const usage = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }

test('throughput is drawn in pixels in the terminal and in braille elsewhere', async ($, on) => {
  const clock = engine(on)
  await clock.set(1_000_000)
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    await clock.advance(1000)
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'T1', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'go', turnId: 'T1' })
  const s = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  // The open column is drawn once the next tick closes it.
  await clock.advance(1200)

  const term = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await term.findAll({ type: 'Raster' })).toHaveLength(1)
  // The speed and its labels are cells of the Raster, so one blit moves them with the area.
  expect(await term.find({ text: /tok\/s/ })).toBeUndefined()
  await term.unmount()
  const desk = await $.ui.mount({ ...pane(60), surface: 'desktop' })
  expect(await desk.find({ type: 'Raster' })).toBeUndefined()
  expect(await desk.find({ text: /[⠁-⣿]/ })).toBeDefined()
  expect(await desk.find({ text: /^\s*121\s*$/ })).toBeDefined()
  expect(await desk.find({ text: /60s/ })).toBeDefined()
  await desk.unmount()
})

test('while a turn runs the graph scrolls between redraws, and stops once nothing runs', async ($, on) => {
  const clock = engine(on)
  await clock.set(1_000_000)
  const blits: string[] = []
  on('ui.blit', (_$, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    await clock.advance(1000)
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'T1', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'go', turnId: 'T1' })
  const s = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await clock.advance(3000)
  expect(blits.length).toBeGreaterThan(0)
  expect(blits.every(k => k === 'graph')).toBe(true)
  await $.turn.complete({ answer: 'done', durationMs: 4200, isAborted: false, turnId: 'T1', reason: 'answer' })
  // One more tick draws it gray, then it stops.
  await clock.advance(1200)
  const after = blits.length
  await clock.advance(5000)
  expect(blits.length).toBe(after)
  await ui.unmount()
})

test('a graph timer the engine ended is started again by the next turn', async ($, on) => {
  let isRefusing = false
  // Ahead of the mock clock: answers the graph's period as it would, but refuses it while asked to.
  on('clock.every', { ms: columnMs(52) }, async (_$, e) => {
    if (isRefusing) return { deny: 'busy' }
    await clock.sleep(e.ms)
    return { value: undefined }
  })
  const clock = engine(on)
  await clock.set(1_000_000)
  const blits: string[] = []
  on('ui.blit', (_$, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'T1', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'go', turnId: 'T1' })
  const s = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await clock.advance(3000)
  expect(blits.length).toBeGreaterThan(0)
  isRefusing = true
  await clock.advance(2000)
  isRefusing = false
  const stalled = blits.length
  await clock.advance(5000)
  expect(blits.length).toBe(stalled)
  await $.turn.start({ text: 'again', turnId: 'T2' })
  await clock.advance(3000)
  expect(blits.length).toBeGreaterThan(stalled)
  await ui.unmount()
})

test('MAIN shows its header alone before anything ran, then the running tool, then the finished turn', async ($, on) => {
  engine(on)
  let release: () => void = () => {}
  on('tool.call', () => new Promise(resolve => (release = () => resolve({ result: {}, text: 'ok' }))))

  const idle = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await idle.find({ text: /waiting|idle/ })).toBeUndefined()
  expect(await idle.find({ text: /^main$/ })).toBeDefined()
  await idle.unmount()

  await $.turn.start({ text: 'go', turnId: 'T1' })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(60), surface })
    expect(await ui.find({ text: /^Bash/ })).toBeDefined()
    expect(await ui.find({ text: /npm test/ })).toBeDefined()
    await ui.unmount()
  }
  release()
  await call
  await $.turn.complete({ answer: 'done', durationMs: 4200, isAborted: false, turnId: 'T1', reason: 'answer' })

  const after = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await after.find({ text: /last turn 4\.2s/ })).toBeDefined()
  expect(await after.find({ text: /idle/ })).toBeUndefined()
  await after.unmount()
})

test("MAIN follows the stream: what the model is doing shows while it does it", async ($, on) => {
  const clock = engine(on)
  await clock.set(1_000_000)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('turn.step', async function* () {
    yield { kind: 'thinking', index: 0, text: 'hmm' } as never
    await gate
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'T1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.turn.start({ text: 'go', turnId: 'T1' })
  const s = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const it = s[Symbol.asyncIterator]()
  await it.next()
  const pending = it.next()
  await clock.settle()
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /thinking…/ })).toBeDefined()
  expect(await ui.find({ text: /opus 5\.5/ })).toBeDefined()
  await ui.unmount()
  release()
  await pending
  for await (const _ of { [Symbol.asyncIterator]: () => it }) void _
  await s.result
})
