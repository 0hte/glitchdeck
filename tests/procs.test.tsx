import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { GLITCH_MS, glitchText } from '../hooks/core/glitch'
import { PROCS_CAP, addProc, applyStep, endingOf, kTokens, newProc, setState, stateOfStatus, topLevel } from '../hooks/core/procs'
import { pane, spawn } from './kit'

// ---------------------------------------------------------------- pure behavior

const note = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>C:\\t\\${id}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

test('task notifications end a process with its exit status', () => {
  expect(endingOf(note('b1', 'completed', 'Background command "x" completed (exit code 0)'))).toEqual({ taskId: 'b1', state: 'X', why: '' })
  expect(endingOf(note('b2', 'failed', 'Background command "x" failed with exit code 2'))).toEqual({ taskId: 'b2', state: 'Z', why: 'exit 2' })
  expect(endingOf(note('a1', 'completed', 'Agent "Design" finished'))).toEqual({ taskId: 'a1', state: 'X', why: '' })
  expect(endingOf(note('b3', 'killed', 'Background command "x" was stopped'))).toEqual({ taskId: 'b3', state: 'Z', why: 'killed' })
  expect(endingOf('<task-notification><task-id>m1</task-id><summary>line of output</summary></task-notification>')).toBeNull()
  expect(endingOf('hello')).toBeNull()
})

test('agent statuses map to htop letters', () => {
  expect(['running', 'waiting', 'idle', 'pending', 'completed', 'failed', 'killed'].map(stateOfStatus)).toEqual(['R', 'S', 'S', 'S', 'X', 'Z', 'Z'])
})

test('a step adds tokens and words; an ending stamps the time once', () => {
  let ps = addProc([], newProc({ id: 'ag1', kind: 'agent', type: 'Explore', task: 'map the API', now: 0 }))
  const usage = { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }
  ps = applyStep(ps, 'ag1', { usage, answer: 'found it', now: 5 })
  expect(ps[0]).toMatchObject({ tokOut: 40, ctx: 1000, steps: 1, lastText: 'found it', state: 'R' })
  ps = setState(ps, 'ag1', 'X', '', 9)
  expect(ps[0]).toMatchObject({ state: 'X', endedAt: 9, changedAt: 9 })
  expect(setState(ps, 'ag1', 'X', '', 12)).toBe(ps)
  expect(applyStep(ps, 'unknown', { usage, answer: '', now: 1 })).toBe(ps)
})

test('past the cap the oldest finished processes go first, then the oldest live ones: the list never grows past it', () => {
  let ps = addProc([], { ...newProc({ id: 'old', kind: 'shell', type: 'bash', task: 'ls', now: 0 }), state: 'X' })
  for (let i = 0; i < PROCS_CAP; i++) ps = addProc(ps, newProc({ id: `live${i}`, kind: 'agent', type: 'Explore', task: 't', now: i + 1 }))
  expect(ps).toHaveLength(PROCS_CAP)
  expect(ps.some(p => p.id === 'old')).toBe(false)
  for (let i = 0; i < 20; i++) ps = addProc(ps, newProc({ id: `more${i}`, kind: 'shell', type: 'bash', task: 't', now: 1000 + i }))
  expect(ps).toHaveLength(PROCS_CAP)
  expect(ps.some(p => p.id === 'live0')).toBe(false)
  expect(ps.some(p => p.id === 'more19')).toBe(true)
})

test('token counts read like htop: exact under a thousand, one decimal under ten thousand', () => {
  expect([840, 1000, 8100, 8149, 31_400, 1_250_000].map(kTokens)).toEqual(['840', '1k', '8.1k', '8.1k', '31k', '1.3M'])
})

test('live processes come first in start order, workflow agents stay inside their workflow', () => {
  let ps = addProc([], { ...newProc({ id: 'done', kind: 'agent', type: 'Plan', task: 't', now: 1 }), state: 'X', endedAt: 4 })
  ps = addProc(ps, newProc({ id: 'b', kind: 'shell', type: 'bash', task: 'sleep 9', now: 3 }))
  ps = addProc(ps, newProc({ id: 'a', kind: 'agent', type: 'Explore', task: 't', now: 2 }))
  ps = addProc(ps, newProc({ id: 'w1', kind: 'wfagent', type: 'review', task: 't', now: 2, parent: 'wf_1' }))
  expect(topLevel(ps).map(p => p.id)).toEqual(['a', 'b', 'done'])
})

test('the glitch keeps the width, repeats per frame and clears when it ends', () => {
  const text = 'map mod API'
  const g = glitchText(text, 'ag1', 1000, 1100)
  expect([...g]).toHaveLength([...text].length)
  expect(g).not.toBe(text)
  expect(glitchText(text, 'ag1', 1000, 1100)).toBe(g)
  expect(glitchText(text, 'ag1', 1000, 1000 + GLITCH_MS)).toBe(text)
  expect(glitchText(text, 'ag1', 0, 5)).toBe(text)
})

// ---------------------------------------------------------------- through the engine

const engine = (on: On) => {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `ag${++n}` }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const notification = (id: string, status: string, summary: string) => ({
  message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text: note(id, status, summary) }] },
  door: 'prompt' as const,
  origin: { kind: 'task-notification' as const },
  uuid: `n-${id}`,
})

test('agents, a background shell and a workflow are listed, the workflow with its agents, and end from their events', async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) =>
    String(e.tool) === 'Bash'
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7' } }
      : String(e.tool) === 'Workflow'
        ? { result: { status: 'async_launched', taskId: 'wt1', runId: 'wf_9', workflowName: 'review-changes' } }
        : { result: {}, text: 'ok' },
  )
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('Explore', 'map mod API'))
  await $.agent.spawn(spawn('voltagent-qa-sec:code-reviewer', 'audit hooks'))
  await $.tool.call({ tool: 'Bash', command: 'npm run e2e', run_in_background: true } as never)
  await $.tool.call({ tool: 'Workflow', name: 'review-changes', description: 'review the diff' } as never)
  await $.agent.spawn(spawn('review', 'bugs', { workflow: { runId: 'wf_9', agentIndex: 1 } }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 56, 80]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /4 live · 4/ })).toBeDefined()
      expect(await ui.find({ key: 'proc-ag1' })).toBeDefined()
      expect(await ui.find({ key: 'proc-ag2' })).toBeDefined()
      expect(await ui.find({ key: 'proc-b7' })).toBeDefined()
      expect(await ui.find({ key: 'proc-wf_9' })).toBeDefined()
      expect(await ui.find({ key: 'proc-ag3' })).toBeDefined()
      await ui.unmount()
    }
  }
  // Types read lowercase; a workflow is named by its script, and its agents by their tasks.
  const named = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await named.find({ type: 'Text', text: /^explore\s*$/ })).toBeDefined()
  expect(await named.find({ type: 'Text', text: /^code-rev/ })).toBeDefined()
  expect(await named.find({ type: 'Text', text: /^workflow\s*$/ })).toBeDefined()
  expect(await named.find({ type: 'Text', text: /^review-changes$/ })).toBeDefined()
  expect(await named.find({ type: 'Text', text: /^bugs\s*$/ })).toBeDefined()
  expect((await named.find({ key: 'proc-wf_9' }))?.text).not.toMatch(/review the diff/)
  await named.unmount()

  await $.session.append(notification('b7', 'failed', 'Background command "npm run e2e" failed with exit code 1'))
  await $.turn.complete({ answer: 'mapped', durationMs: 10, isAborted: false, turnId: 'A1', agentId: 'ag1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(56), surface: 'terminal' })
  expect(await ui.find({ text: /2 live · 4/ })).toBeDefined()
  expect(await ui.find({ text: /exit 1/ })).toBeDefined()
  await ui.unmount()
})

test('an agent opens its live timeline, and back returns to the list', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.step', async function* () {
    const usage = { input_tokens: 10, output_tokens: 1200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'the hooks look fine', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.agent.spawn(spawn('Explore', 'map mod API'))
  await $.tool.call({ tool: 'Grep', pattern: 'ui.scroll', agentId: 'ag1' } as never)
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'ag1' })
  for await (const _ of s) void _
  await s.result

  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'proc-ag1' })
  expect(await ui.find({ text: /ui\.scroll/ })).toBeDefined()
  expect(await ui.find({ text: /1\.2k out · 1 step · 1 tool$/ })).toBeDefined()
  expect(await ui.find({ text: /the hooks look fine/ })).toBeDefined()
  await ui.press({ key: 'procs-back' })
  expect(await ui.find({ key: 'procs-back' })).toBeUndefined()
  expect(await ui.find({ key: 'proc-ag1' })).toBeDefined()
  // Back in the list, a live agent shows its last call under it.
  expect(await ui.find({ text: /↳ Grep ui\.scroll/ })).toBeDefined()
  await ui.unmount()
})

test('a state change glitches the row, and the clock-driven frames bring it back clean', async ($, on) => {
  const clock = engine(on)
  // The mock clock starts at 0, which glitchdeck reads as "never changed".
  await clock.set(1_000_000)
  await $.agent.spawn(spawn('Explore', 'map mod API'))
  await clock.advance(60)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'map mod API' })).toBeUndefined()
  // No remount: only the glitch timer's frames can redraw the pane.
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'map mod API' })).toBeDefined()
  await ui.unmount()
})
