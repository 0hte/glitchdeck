import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { promptsFromMessages } from '../hooks/core/history'
import { addProc, applyList, callsFromMessages, endChildren, endMissing, newProc, setState, withBackfill } from '../hooks/core/procs'
import { heightOf, note, pane, spawn } from './kit'

// ---------------------------------------------------------------- pure behavior

test("at a stop, work missing from the in-flight list has ended, an agent's commands too; a nested agent waits", () => {
  let ps = addProc([], newProc({ id: 'b1', kind: 'shell', type: 'bash', task: 'sleep 1', now: 0 }))
  ps = addProc(ps, newProc({ id: 'b2', kind: 'shell', type: 'bash', task: 'sleep 99', now: 0 }))
  ps = addProc(ps, newProc({ id: 'b3', kind: 'shell', type: 'bash', task: 'started by an agent', now: 0, parent: 'ag1' }))
  ps = addProc(ps, newProc({ id: 'ag2', kind: 'agent', type: 'Explore', task: 'nested, in the foreground', now: 0, parent: 'ag1' }))
  expect(endMissing(ps, new Set(['b2']), 7).map(p => [p.id, p.state])).toEqual([
    ['b1', 'X'],
    ['b2', 'R'],
    ['b3', 'X'],
    ['ag2', 'R'],
  ])
})

test("an agent's final answer ends the commands that end with it, and only those", () => {
  let ps = addProc([], newProc({ id: 'ag1', kind: 'agent', type: 'Explore', task: 'map', now: 0 }))
  ps = addProc(ps, newProc({ id: 'b1', kind: 'shell', type: 'bash', task: 'npm test', now: 0, parent: 'ag1', endsWithParent: true }))
  ps = addProc(ps, newProc({ id: 'b2', kind: 'shell', type: 'bash', task: 'npm run dev', now: 0, parent: 'ag1' }))
  expect(endChildren(ps, 'ag1', 5).map(p => [p.id, p.state])).toEqual([
    ['ag1', 'R'],
    ['b1', 'X'],
    ['b2', 'R'],
  ])
})

test('the agent list never brings back an agent that ended while it was being read', () => {
  let ps = addProc([], newProc({ id: 'ag1', kind: 'agent', type: 'Explore', task: 'map', now: 0 }))
  ps = setState(ps, 'ag1', 'X', '', 5)
  const listed = [
    { id: 'ag1', status: 'running', type: 'Explore', description: 'map' },
    { id: 'ag9', status: 'running', type: 'voltagent-qa-sec:code-reviewer', description: 'audit' },
  ]
  const after = applyList(ps, listed, 6)
  expect(after.map(p => [p.id, p.state, p.type])).toEqual([
    ['ag1', 'X', 'Explore'],
    ['ag9', 'R', 'code-reviewer'],
  ])
  expect(applyList(after, [{ id: 'ag9', status: 'failed', type: 'x', description: '' }], 7).find(p => p.id === 'ag9')?.state).toBe('Z')
})

test('calls read back take their state from their results, and merge under the ones seen live', () => {
  const rows = [
    {
      toolUses: [
        { tool_use_id: 't1', tool: 'Read', input: { file_path: '/a/b.ts' } },
        { tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test' } },
        { tool_use_id: 't3', tool: 'Grep', input: { pattern: 'x' } },
      ],
    },
    { toolUses: [], toolResults: [{ tool_use_id: 't1', isError: false }, { tool_use_id: 't2', isError: true }] },
  ]
  const target = (_tool: string, input: unknown) => JSON.stringify(input)
  expect(callsFromMessages(rows, true, target).map(c => c.state)).toEqual(['ok', 'err', 'run'])
  const back = callsFromMessages(rows, false, target)
  expect(back.map(c => c.state)).toEqual(['ok', 'err', 'err'])
  const seen = { calls: [{ id: 't3', tool: 'Grep', target: 'x', state: 'ok' as const, startedAt: 9, ms: 4 }], total: 1 }
  const merged = withBackfill(seen, back)
  expect(merged.calls.map(c => [c.id, c.ms])).toEqual([
    ['t1', null],
    ['t2', null],
    ['t3', 4],
  ])
  expect(merged.total).toBe(3)
})

test('a transcript too large to read falls back to the typed prompts among the messages', () => {
  const list = promptsFromMessages([
    { role: 'user', text: 'first prompt' },
    { role: 'assistant', text: 'sure' },
    { role: 'user', text: '', toolResults: [{}] },
    { role: 'user', text: note('b1', 'completed', 'done') },
    { role: 'user', text: '<command-name>/plan</command-name>' },
    { role: 'user', text: '[Request interrupted by user]' },
    { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context.' },
    { role: 'user', text: 'second prompt' },
  ])
  expect(list.map(p => [p.n, p.uuid, p.text])).toEqual([
    [1, '', 'first prompt'],
    [2, '', 'second prompt'],
  ])
})

// ---------------------------------------------------------------- through the engine

const engine = (on: On) => {
  mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `ag${++n}` }))
  on('turn.complete', () => ({ text: '' }))
}

const shell = (id: string, extra: object = {}) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id, ...extra } })

const folded = (id: string, agentId?: string) => ({
  message: {
    type: 'attachment' as const,
    name: 'queued_command',
    content: [{ type: 'text' as const, text: note(id, 'completed', 'Background command "x" completed (exit code 0)') }],
  },
  door: 'attachment' as const,
  origin: { kind: 'engine' } as never,
  uuid: `f-${id}`,
  ...(agentId ? { agentId } : {}),
})

test('a notification folded into a running turn, or reaching a subagent, still ends its process', async ($, on) => {
  engine(on)
  let n = 0
  on('tool.call', () => shell(`b${++n}`))
  await $.agent.spawn(spawn('Explore', 'map'))
  await $.tool.call({ tool: 'Bash', command: 'sleep 1', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'sleep 2', run_in_background: true, agentId: 'ag1' } as never)
  await $.session.append(folded('b1')).catch(() => undefined)
  await $.session.append(folded('b2', 'ag1')).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /1 live · 3/ })).toBeDefined()
  await ui.unmount()
})

test("a synchronous agent's background command ends with its answer, with no notification", async ($, on) => {
  engine(on)
  on('tool.call', () => shell('b5', { backgroundEndsWithFinalResponse: true }))
  await $.agent.spawn(spawn('Explore', 'run the tests'))
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true, agentId: 'ag1' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'A1', agentId: 'ag1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /0 live · 2/ })).toBeDefined()
  await ui.unmount()
})

test('a stop ends background work that is no longer in flight, and an absent list ends nothing', async ($, on) => {
  engine(on)
  let n = 0
  on('tool.call', () => shell(`b${++n}`))
  on('classic.Stop', () => ({}))
  await $.tool.call({ tool: 'Bash', command: 'sleep 1', run_in_background: true } as never)
  await $.classic.Stop({ stop_hook_active: false } as never)
  const before = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await before.find({ text: /1 live · 1/ })).toBeDefined()
  await before.unmount()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /0 live · 1/ })).toBeDefined()
  await ui.unmount()
})

const exited = (code: number) => ({ status: 'completed', statusMessage: `Exited with code ${code}.`, result: { content: [], isError: code !== 0 } })

test('a GetTask check ends a command that exited or was stopped, with its exit code; a working one runs on', async ($, on) => {
  engine(on)
  let n = 0
  const answers: Record<string, object> = {
    b1: { status: 'working' },
    b2: exited(0),
    b3: exited(3),
    b4: { status: 'cancelled' },
    b5: { status: 'failed', error: { code: 1, message: 'boom' } },
  }
  on('tool.call', (_$, e) => (e.tool === 'GetTask' ? { result: answers[(e as { taskId: string }).taskId] } : shell(`b${++n}`)))
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'sleep 1', run_in_background: true } as never)
  for (const taskId of Object.keys(answers)) await $.tool.call({ tool: 'GetTask', taskId } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /1 live · 5/ })).toBeDefined()
  expect(await ui.find({ text: /exit 3/ })).toBeDefined()
  expect(await ui.find({ text: /killed/ })).toBeDefined()
  expect(await ui.find({ text: /failed/ })).toBeDefined()
  await ui.unmount()
})

test('a GetTask check never rewrites how a command already ended', async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) => (e.tool === 'GetTask' ? { result: exited(3) } : shell('b1')))
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
  await $.session.append({ ...folded('b1'), message: { ...folded('b1').message, content: [{ type: 'text' as const, text: note('b1', 'failed', 'Background command "x" failed with exit code 2') }] } })
  await $.tool.call({ tool: 'GetTask', taskId: 'b1' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /exit 2/ })).toBeDefined()
  expect(await ui.find({ text: /exit 3/ })).toBeUndefined()
  await ui.unmount()
})

test('a narrow, short pane shows what fits, folds the rest into +N more, and stays inside its rows and width', async ($, on) => {
  engine(on)
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  // 8 rows: MAIN's header, the gap and header, three processes and the line folding the rest.
  const ui = await $.ui.mount({ ...pane(30, 8), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-ag3' })).toBeDefined()
  expect(await ui.find({ key: 'proc-ag4' })).toBeUndefined()
  expect(await ui.find({ text: /\+2 more/ })).toBeDefined()
  const root = (await ui.drawn()) as { props?: { width?: number } }
  expect(root.props?.width).toBe(30)
  expect(heightOf(root)).toBeLessThanOrEqual(8)
  await ui.unmount()
})

test("a big live workflow shows a few of its agents, so the rest of the list keeps its place", async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) =>
    String(e.tool) === 'Workflow' ? { result: { status: 'async_launched', taskId: 'wt1', runId: 'wf_1', workflowName: 'review-changes' } } : { result: {}, text: 'ok' },
  )
  await $.agent.spawn(spawn('Explore', 'an unrelated agent'))
  await $.tool.call({ tool: 'Workflow', name: 'review-changes' } as never)
  for (let i = 0; i < 45; i++) await $.agent.spawn(spawn('review', `part ${i}`, { workflow: { runId: 'wf_1', agentIndex: i } }))
  const ui = await $.ui.mount({ ...pane(60, 45), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-ag1' })).toBeDefined()
  expect(await ui.find({ key: 'proc-wf_1' })).toBeDefined()
  expect(await ui.find({ text: /\+42 more/ })).toBeDefined()
  expect(await ui.find({ text: /review-changes/ })).toBeDefined()
  await ui.unmount()
})
