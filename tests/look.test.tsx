// The look the pane was designed to, held as checks over what it draws: no frames, no fills,
// one accent for what is alive, a hatch-ruled header per section, breathing bars on live work.
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { mix } from '../hooks/core/color'
import { BREATH_MS, C, graphColor } from '../hooks/palette'
import { byKey, colorsIn, heightOf, note, pane, promptRow, spawn, textOf, walk } from './kit'
import type { Node } from './kit'

const usage = { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }

/** A busy session: a turn running a call, a live and a finished agent, a failed command, a workflow, todos, a file, prompts. */
async function busy($: Engine, on: On) {
  const clock = mock.clock(on)
  await clock.set(1_000_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `ag${++n}` }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let release: () => void = () => {}
  on('tool.call', (_$, e) => {
    const tool = String(e.tool)
    const input = e as unknown as { run_in_background?: boolean }
    if (tool === 'Bash' && input.run_in_background) return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
    if (tool === 'Workflow') return { result: { status: 'async_launched', taskId: 'wt1', runId: 'wf_1', workflowName: 'review-changes' } }
    if (tool === 'Bash') return new Promise(resolve => (release = () => resolve({ result: {}, text: 'ok' })))
    return { result: {}, text: 'ok' }
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
  await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/core/procs.ts' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'map', status: 'completed', activeForm: 'Mapping' },
      { content: 'wire', status: 'in_progress', activeForm: 'Wiring the press hook' },
    ],
  } as never)
  await $.agent.spawn(spawn('Explore', 'map hooks/ structure'))
  await $.tool.call({ tool: 'Grep', pattern: 'isLive', agentId: 'ag1' } as never)
  await $.agent.spawn(spawn('Plan', 'design layout'))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'A2', agentId: 'ag2', reason: 'answer' })
  await $.tool.call({ tool: 'Bash', command: 'sleep 15 && exit 1', run_in_background: true } as never)
  await $.session.append({
    message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text: note('b1', 'failed', 'Background command failed with exit code 1') }] },
    door: 'prompt' as const,
    origin: { kind: 'task-notification' as const },
    uuid: 'n-b1',
  })
  await $.tool.call({ tool: 'Workflow', name: 'review-changes' } as never)
  await $.agent.spawn(spawn('review', 'bugs', { workflow: { runId: 'wf_1', agentIndex: 0 } }))
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000001', 'first prompt'))
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000002', 'second prompt'))
  const running = $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  // A test that never finishes the turn leaves the call held; the kit lets it go once it outlasts its budget.
  running.catch(() => undefined)
  await clock.settle()
  const finish = async () => {
    release()
    await running
    await $.turn.complete({ answer: 'done', durationMs: 4200, isAborted: false, turnId: 'T1', reason: 'answer' })
  }
  return { clock, finish }
}

const isHatch = (el: Node) => el.type === 'Text' && /^╱+$/.test(textOf(el))

test('the pane is borderless and paints no background, only a hover', async ($, on) => {
  await busy($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(60, 60), surface })
    walk(await ui.drawn(), el => {
      expect(el.props?.borderStyle, `${el.type} has a border`).toBeUndefined()
      expect(el.props?.backgroundColor, `${el.type} paints a background`).toBeUndefined()
    })
    await ui.unmount()
  }
})

test('every color drawn is one of the palette, the hatch aside', async ($, on) => {
  await busy($, on)
  const ui = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const palette = new Set(Object.values(C))
  walk(await ui.drawn(), el => {
    if (el.type === 'Text' && typeof el.props?.color === 'string' && !isHatch(el)) expect(palette.has(el.props.color), el.props.color).toBe(true)
  })
  expect(C.accent).toBe('#5CE1FF')
  await ui.unmount()
})

test('the accent marks only what is alive: finished and failed work goes gray or red', async ($, on) => {
  const { finish } = await busy($, on)
  const ui = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const tree = await ui.drawn()
  expect(colorsIn(byKey(tree, 'row-ag2'))).not.toContain(C.accent)
  expect(colorsIn(byKey(tree, 'row-b1'))).not.toContain(C.accent)
  expect(colorsIn(byKey(tree, 'row-b1'))).toContain(C.err)
  const clockColor = (id: string) => (byKey(tree, `proc-clock-${id}`)?.props?.props as { color?: string } | undefined)?.color
  expect(clockColor('ag1')).toBe(C.accent)
  expect(clockColor('ag2')).toBe(C.dim)
  expect(clockColor('b1')).toBe(C.dim)
  // A finished call's row: its glyph, name, target and time, and no accent among them.
  walk(tree, (el, above) => {
    if (el.type !== 'Text' || !/^\s+[✓✗⊘] $/.test(textOf(el))) return
    const row = [...above].reverse().find(a => a.props?.justifyContent === 'space-between')
    expect(colorsIn(row)).not.toContain(C.accent)
  })
  expect(colorsIn(byKey(tree, 'main'))).toContain(C.accent)
  await ui.unmount()

  await finish()
  const after = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const done = byKey(await after.drawn(), 'main')
  expect(colorsIn(done)).not.toContain(C.accent)
  walk(done, el => {
    if (el.type === 'Client') expect((el.props?.props as { color?: string })?.color).not.toBe(C.accent)
  })
  await after.unmount()
})

test('every section opens with its name, a fading hatch rule and its status on the right', async ($, on) => {
  await busy($, on)
  const ui = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const tree = await ui.drawn()
  for (const key of ['main', 'procs', 'history']) {
    const section = byKey(tree, key)
    const head = section?.children?.[0] as Node | undefined
    expect(head?.props?.justifyContent, key).toBe('space-between')
    expect(head?.children ?? [], key).toHaveLength(2)
    const runs: string[] = []
    walk(head, el => {
      if (isHatch(el)) runs.push(String(el.props?.color))
    })
    expect(runs.length, key).toBeGreaterThan(1)
    expect(runs[0]).not.toBe(runs[runs.length - 1])
    expect(runs[runs.length - 1]?.toLowerCase()).toBe(C.faint.toLowerCase())
  }
  await ui.unmount()
})

test('live rows breathe in step, finished rows hold still', async ($, on) => {
  await busy($, on)
  const ui = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const tree = await ui.drawn()
  for (const key of ['bar-ag1', 'bar-wf_1']) expect(byKey(tree, key)?.props?.module, key).toMatch(/clients\/breathe\.tsx$/)
  // A row's first child is its bar.
  const barOf = (id: string) => byKey(tree, `row-${id}`)?.children?.[0] as Node | undefined
  expect(barOf('ag2')?.type).toBe('Box')
  expect(colorsIn(barOf('ag2'))).toEqual([])
  expect(barOf('b1')?.type).toBe('Box')
  expect(colorsIn(barOf('b1'))).toEqual([C.err])
  const mainBars: string[] = []
  walk(byKey(tree, 'main'), el => {
    if (el.type === 'Client' && String(el.props?.module).endsWith('clients/breathe.tsx')) mainBars.push(String(el.props?.key))
  })
  expect(mainBars.length).toBeGreaterThan(0)

  // Bars of different heights, in different sections, still breathe as one.
  const barColor = async (key: string) => colorsIn(await ui.drawn({ in: key }))[0]
  const keys = ['bar-ag1', 'bar-wf_1', mainBars[0] ?? '']
  const before = await Promise.all(keys.map(barColor))
  expect(new Set(before).size).toBe(1)
  await ui.advance(BREATH_MS)
  const after = await Promise.all(keys.map(barColor))
  expect(new Set(after).size).toBe(1)
  expect(after[0]).not.toBe(before[0])
  await ui.unmount()
})

test('clocks tick on the surface clock, with no redraw of the pane', async ($, on) => {
  await busy($, on)
  const ui = await $.ui.mount({ ...pane(60, 60), surface: 'terminal' })
  const before = textOf(await ui.drawn({ in: 'turn-clock' }))
  await ui.advance(2000)
  expect(textOf(await ui.drawn({ in: 'turn-clock' }))).not.toBe(before)
  await ui.unmount()
})

test('the graph is in the accent while a turn runs, gray after, and never darker than the rule', () => {
  const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const floor = channels(C.faint)
  for (const isLive of [true, false])
    for (const top of [0, 0.5, 1])
      for (const age of [0, 0.5, 1]) channels(graphColor(isLive)(top, age)).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(floor[i] ?? 0))
  expect(graphColor(true)(0, 0)).toBe(mix(C.accent, C.faint, 0.08))
  expect(graphColor(false)(0, 0)).toBe(mix(C.dim, C.faint, 0.08))
})

// From 14 rows, where this session's minimums fit: below that the pane scrolls rather than drop what runs now.
test('the drawn pane never takes more rows or columns than it has', async ($, on) => {
  await busy($, on)
  for (const cols of [30, 44, 60, 90])
    for (const rows of [14, 20, 24, 30, 40, 60]) {
      const ui = await $.ui.mount({ ...pane(cols, rows), surface: 'terminal' })
      const tree = (await ui.drawn()) as Node
      expect(heightOf(tree), `${cols}x${rows}`).toBeLessThanOrEqual(rows)
      expect(tree.props?.width).toBe(cols)
      await ui.unmount()
    }
})
