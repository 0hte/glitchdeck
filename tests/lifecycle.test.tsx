// The session around the pane: opening on start, closing and staying closed, /glitchdeck, /clear,
// a resume's history, what tool calls change, agents found by the list, calls read back.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { pane, promptRow, spawn } from './kit'

type Pane = { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }
type Agent = { id: string; status: string; type: string; description: string }

const START = { cwd: 'C:\\repo', surface: 'terminal' as const, isInteractive: true }

/** The engine beneath: a pane list, the opens and closes asked of it, toasts, the agent list. */
const world = (on: On) => {
  const clock = mock.clock(on)
  const w = { clock, panes: [] as Pane[], opened: [] as string[], closed: [] as string[], toasts: [] as string[], agents: [] as Agent[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'glitchdeck' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('agent.list', () => ({ value: w.agents as never }))
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  return w
}

const shown: Pane = { id: 'glitchdeck', title: 'glitchdeck', isShown: true, isFocused: false, isPlaced: true }
const run = (args: string) => ({ command: 'glitchdeck', args, origin: { kind: 'composer' }, presentation: 'inline' }) as never

test('on start it registers its command, learns the model and opens the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.opened).toEqual(['glitchdeck'])
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /^opus 5\.5$/ })).toBeDefined()
  await ui.unmount()
})

test('with openOnStart off it waits to be asked', { options: { openOnStart: false } }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.opened).toEqual([])
  await $.command.run(run('open'))
  expect(w.opened).toEqual(['glitchdeck'])
})

test('a pane closed with /glitchdeck stays closed when the mod reloads, until it is opened again', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.panes = [shown]
  await $.command.run(run(''))
  w.panes = []
  await $.session.start(START)
  expect(w.opened).toEqual(['glitchdeck'])
  await $.command.run(run(''))
  expect(w.opened).toEqual(['glitchdeck', 'glitchdeck'])
})

test('/glitchdeck closes a shown pane and opens a hidden one', async ($, on) => {
  const w = world(on)
  w.panes = [shown]
  await $.command.run(run(''))
  expect(w.closed).toEqual(['glitchdeck'])
  w.panes = []
  await $.command.run(run(''))
  expect(w.opened).toEqual(['glitchdeck'])
  w.panes = [shown]
  await $.command.run(run('open'))
  expect(w.opened).toEqual(['glitchdeck', 'glitchdeck'])
  await $.command.run(run('close'))
  expect(w.closed).toEqual(['glitchdeck', 'glitchdeck'])
})

test('/clear starts everything over', async ($, on) => {
  const w = world(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }))
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000001', 'before the clear'))
  await $.agent.spawn(spawn('Explore', 'old work'))
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /before the clear/ })).toBeUndefined()
  expect(await ui.find({ key: 'proc-ag1' })).toBeUndefined()
  await ui.unmount()
  expect(w.toasts).toEqual([])
})

const jsonl = [
  JSON.stringify({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, timestamp: '2026-10-14T10:00:00.000Z', message: { role: 'user', content: 'from the file' } }),
  JSON.stringify({ type: 'user', uuid: 'u2', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>' } }),
].join('\n')

const said = (text: string) => ({ role: 'user', text, toolUses: [] })

test('a resumed session reads its prompts back from its transcript', async ($, on) => {
  world(on)
  on('fs.read', () => ({ value: jsonl }))
  await $.classic.SessionStart({ source: 'resume', transcript_path: 'C:\\t.jsonl' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from the file/ })).toBeDefined()
  expect(await ui.find({ key: 'hist-2' })).toBeUndefined()
  await ui.unmount()
})

test("past what a plugin can read, the session's messages stand in; when both fail it says so", async ($, on) => {
  const w = world(on)
  let isReadable = true
  on('fs.read', () => ({ deny: 'over 4 MiB' }))
  on('session.messages', () => (isReadable ? { value: [said('from the messages')] as never } : { deny: 'unavailable' }))
  await $.classic.SessionStart({ source: 'resume', transcript_path: 'C:\\big.jsonl' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from the messages/ })).toBeDefined()
  await ui.unmount()
  isReadable = false
  await $.classic.SessionStart({ source: 'resume', transcript_path: 'C:\\big.jsonl' } as never)
  expect(w.toasts.some(t => t.includes("couldn't read"))).toBe(true)
})

test("an in-session /resume that classic.SessionStart reaches keeps the transcript's prompts at the next one", async ($, on) => {
  world(on)
  on('fs.read', () => ({ value: jsonl }))
  on('session.messages', () => ({ value: [said('from the messages')] as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
  await $.classic.SessionStart({ source: 'resume', transcript_path: 'C:\\t.jsonl' } as never)
  await $.prompt.submit({ text: 'next one', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from the file/ })).toBeDefined()
  expect(await ui.find({ text: /from the messages/ })).toBeUndefined()
  await ui.unmount()
})

test('where classic.SessionStart never runs, a session started with messages reads its prompts back', async ($, on) => {
  world(on)
  on('session.messages', () => ({ value: [said('from the messages'), said('<task-notification>')] as never }))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from the messages/ })).toBeDefined()
  expect(await ui.find({ key: 'hist-2' })).toBeUndefined()
  await ui.unmount()
})

test('unreadable messages stay quiet at a start, which may have none, and are told after a /resume', async ($, on) => {
  const w = world(on)
  on('session.messages', () => ({ deny: 'unavailable' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start(START)
  expect(w.toasts).toEqual([])
  await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
  await $.prompt.submit({ text: 'next one', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  expect(w.toasts.some(t => t.includes("couldn't read"))).toBe(true)
})

test('a late read of the messages never replaces a history already written', async ($, on) => {
  world(on)
  let rows: object[] = []
  on('session.messages', () => ({ value: rows as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start(START)
  rows = [said('from the messages')]
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000005', 'typed first'))
  await $.prompt.submit({ text: 'typed first', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /typed first/ })).toBeDefined()
  expect(await ui.find({ text: /from the messages/ })).toBeUndefined()
  await ui.unmount()
})

test('where classic.SessionStart never runs, messages that load after the start are read at the first prompt', async ($, on) => {
  world(on)
  let rows: object[] = []
  on('session.messages', () => ({ value: rows as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start(START)
  rows = [said('from before the restart')]
  await $.prompt.submit({ text: 'first one', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000004', 'first one'))
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from before the restart/ })).toBeDefined()
  expect(await ui.find({ text: /first one/ })).toBeDefined()
  await ui.unmount()
})

test('a reload keeps the history it has instead of reading it back', async ($, on) => {
  world(on)
  on('session.messages', () => ({ value: [said('from the messages')] as never }))
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000002', 'typed live'))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /typed live/ })).toBeDefined()
  expect(await ui.find({ text: /from the messages/ })).toBeUndefined()
  await ui.unmount()
})

test('where classic.SessionStart never runs, an in-session /resume starts HISTORY over and reads the resumed prompts before the next one', async ($, on) => {
  world(on)
  let rows = [said('from the old session')]
  on('session.messages', () => ({ value: rows as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start(START)
  await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
  rows = [said('from the resumed session')]
  const before = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await before.find({ text: /from the old session/ })).toBeUndefined()
  await before.unmount()
  await $.prompt.submit({ text: 'next one', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  await $.session.append(promptRow('00000000-0000-4000-8000-000000000003', 'next one'))
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /from the resumed session/ })).toBeDefined()
  expect(await ui.find({ text: /next one/ })).toBeDefined()
  expect(await ui.find({ key: 'hist-3' })).toBeUndefined()
  await ui.unmount()
})

test('a prompt read back without its row id finds its row by text once the row is drawn', async ($, on) => {
  const w = world(on)
  on('session.messages', () => ({ value: [said('find me by text')] as never }))
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'hist-1' })
  expect(w.toasts.at(-1)).toMatch(/not drawn yet/)
  const row = await $.ui.mount({
    plugin: 'glitchdeck',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: '3f2a9c1e-7b1d-4e0a-9c2f-1a2b3c4d5e6f',
    props: { text: 'find me by text', origin: { kind: 'composer' }, isExpanded: false },
  })
  await row.unmount()
  await ui.press({ key: 'hist-1' })
  expect(w.toasts.at(-1)).toMatch(/prompt 1:/)
  expect(w.toasts.at(-1)).not.toMatch(/not drawn yet/)
  await ui.unmount()
})

test('tool calls change the todo line, the tasks, and start and stop monitors', async ($, on) => {
  world(on)
  on('tool.call', (_$, e) => {
    const tool = String(e.tool)
    if (tool === 'TaskCreate') return { result: { task: { id: '7', subject: 'Ship it' } } }
    if (tool === 'Monitor') return { result: { taskId: 'm1' } }
    return { result: {}, text: 'ok' }
  })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'A' },
      { content: 'b', status: 'pending', activeForm: 'B' },
    ],
  } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /1\/2/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'TaskCreate', subject: 'Ship it', description: 'ship' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', activeForm: 'Shipping it' } as never)
  await $.tool.call({ tool: 'Monitor', description: 'watch the logs', timeout_ms: 1000, command: 'tail -f x' } as never)
  const busy = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await busy.find({ text: /1\/3/ })).toBeDefined()
  expect(await busy.find({ text: /Shipping it/ })).toBeDefined()
  expect(await busy.find({ text: /watch the logs/ })).toBeDefined()
  expect(await busy.find({ text: /1 live · 1/ })).toBeDefined()
  await busy.unmount()

  await $.tool.call({ tool: 'TaskStop', task_id: 'm1' } as never)
  const stopped = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await stopped.find({ text: /killed/ })).toBeDefined()
  expect(await stopped.find({ text: /0 live · 1/ })).toBeDefined()
  await stopped.unmount()
})

test('an agent running before the mod loaded is found in the agent list and followed until it ends', async ($, on) => {
  const w = world(on)
  w.agents = [{ id: 'bg1', status: 'running', type: 'voltagent-qa-sec:code-reviewer', description: 'scan the hooks' }]
  await $.session.start(START)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /scan the hooks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^code-rev/ })).toBeDefined()
  expect(await ui.find({ text: /1 live · 1/ })).toBeDefined()
  w.agents = [{ ...w.agents[0]!, status: 'completed' }]
  await w.clock.advance(3000)
  expect(await ui.find({ text: /0 live · 1/ })).toBeDefined()
  await ui.unmount()
})

test("opening an agent that ran before the mod loaded reads its calls back, once", async ($, on) => {
  const w = world(on)
  w.agents = [{ id: 'bg1', status: 'running', type: 'Explore', description: 'map' }]
  let reads = 0
  on('session.messages', (_$, e) => {
    if ((e as { agentId?: string }).agentId !== 'bg1') return { value: [] as never }
    reads += 1
    const rows = [
      {
        role: 'assistant',
        text: '',
        toolUses: [
          { tool_use_id: 't1', tool: 'Read', input: { file_path: '/a/b.ts' } },
          { tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test' } },
        ],
      },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: '', isError: false }, { tool_use_id: 't2', text: '', isError: true }] },
    ]
    return { value: rows as never }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'proc-bg1' })
  expect(await ui.find({ text: /npm test/ })).toBeDefined()
  expect(await ui.find({ text: /2 tools/ })).toBeDefined()
  await ui.press({ key: 'procs-back' })
  await ui.press({ key: 'proc-bg1' })
  expect(reads).toBe(1)
  await ui.unmount()
})

const shell = (id: string) => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } })

test("a stop control kills the row it sits on, and the turn's receipt does not count the press", async ($, on) => {
  const w = world(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_$, e) => (e.tool === 'TaskStop' ? { result: { message: 'stopped', task_id: 'b1', task_type: 'bash' } } : shell('b1')))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 'T1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'sleep 120', run_in_background: true } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-b1~stop' })).toBeDefined()
  await ui.press({ key: 'proc-b1~stop' })
  await w.clock.settle()
  expect(await ui.find({ text: /killed/ })).toBeDefined()
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' } as never)
  // The press raised a call of its own: the turn counts the command it ran, not the button.
  expect(await ui.find({ text: /1 tool$/ })).toBeDefined()
  await ui.unmount()
})

test('only work that can be stopped carries the control', async ($, on) => {
  const w = world(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', (_$, e) =>
    e.tool === 'Workflow' ? { result: { status: 'async_launched', taskId: 'wt9', runId: 'wf_9', workflowName: 'review' } } : shell('b1'),
  )
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 'T1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'sleep 120', run_in_background: true } as never)
  await $.agent.spawn(spawn('Explore', 'map the mod', { workflow: { runId: 'wf_9', agentIndex: 1 } }) as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-b1~stop' })).toBeDefined()
  // The run's agents came first: until its Workflow call answers, it has no task id to stop it by.
  expect(await ui.find({ key: 'proc-wf_9~stop' })).toBeUndefined()
  // A workflow's agent ends with its run and has no task id of its own.
  expect(await ui.find({ key: 'proc-ag1~stop' })).toBeUndefined()
  await $.tool.call({ tool: 'Workflow', name: 'review' } as never)
  expect(await ui.find({ key: 'proc-wf_9~stop' })).toBeDefined()
  await w.clock.settle()
  await ui.unmount()
})

test('the turn control stops the running turn, and says so when the turn is already gone', async ($, on) => {
  const w = world(on)
  const aborted: string[] = []
  let isGone = false
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.abort', (_$, e) => {
    if (isGone) return { deny: 'T1 is not the running turn' }
    aborted.push(e.turnId)
    return { value: undefined }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 'T1' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'main-abort' })
  await w.clock.settle()
  expect(aborted).toEqual(['T1'])
  isGone = true
  await ui.press({ key: 'main-abort' })
  await w.clock.settle()
  expect(w.toasts.at(-1)).toMatch(/can't stop this turn/)
  await ui.unmount()
})
