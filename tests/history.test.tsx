import { expect, mock, test } from 'claude-code/testing'

import { keepRow, promptText, promptsFromMessages, promptsFromTranscript, pushPrompt, rowKey } from '../hooks/core/history'
import { fit, redact, shorten } from '../hooks/core/text'
import { pane, promptRow as prompt } from './kit'

const UUID = '3f2a9c1e-7b1d-4e0a-9c2f-1a2b3c4d5e6f'

test('history numbers prompts like shell history and drops repeats', () => {
  let list = pushPrompt([], { uuid: 'a', text: 'first', at: 1 })
  list = pushPrompt(list, { uuid: 'b', text: '  second\n line ', at: 2 })
  list = pushPrompt(list, { uuid: 'b', text: 'second again', at: 3 })
  list = pushPrompt(list, { uuid: 'c', text: '   ', at: 4 })
  expect(list.map(p => [p.n, p.text])).toEqual([
    [1, 'first'],
    [2, 'second line'],
  ])
})

test('a repeated or empty prompt hands back the same list, so nothing is written', () => {
  const list = pushPrompt([], { uuid: 'a', text: 'first', at: 1 })
  expect(pushPrompt(list, { uuid: 'a', text: 'again', at: 2 })).toBe(list)
  expect(pushPrompt(list, { uuid: 'b', text: ' ', at: 2 })).toBe(list)
})

test('a resumed transcript yields only the typed prompts, those typed mid-turn included', () => {
  const row = (o: object) => JSON.stringify({ type: 'user', isSidechain: false, timestamp: '2026-10-14T10:00:00.000Z', ...o })
  const queued = (uuid: string, kind: string, prompt: string) => row({ type: 'attachment', uuid, attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind } } })
  const jsonl = [
    row({ uuid: 'u1', origin: { kind: 'human' }, message: { role: 'user', content: 'first prompt' } }),
    queued('a1', 'human', 'typed while it worked'),
    queued('a2', 'peer', 'another session talking'),
    queued('a3', 'human', '/compact'),
    row({ uuid: 'u2', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>…' } }),
    row({ uuid: 'u3', message: { role: 'user', content: '<command-name>/plan</command-name>' } }),
    row({ uuid: 'u4', isMeta: true, origin: { kind: 'human' }, message: { role: 'user', content: 'meta' } }),
    row({ uuid: 'u5', isSidechain: true, origin: { kind: 'human' }, message: { role: 'user', content: 'agent' } }),
    row({ uuid: 'u6', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'second "human" prompt' }] } }),
    '{not json "human"',
  ].join('\n')
  expect(promptsFromTranscript(jsonl).map(p => [p.n, p.uuid, p.text])).toEqual([
    [1, 'u1', 'first prompt'],
    [2, 'a1', 'typed while it worked'],
    [3, 'u6', 'second "human" prompt'],
  ])
})

test("past the transcript's size, the session's messages yield the typed prompts, those typed mid-turn included", () => {
  const framed = '<system-reminder>\nThe user sent a new message while you were working:\ntyped while it worked\n\nThis is how Claude Code surfaces messages the user sends mid-turn.\n</system-reminder>'
  const rows = [
    { role: 'user', text: 'first prompt' },
    { role: 'user', text: framed, toolResults: [{}] },
    { role: 'user', text: '<task-notification>…' },
    { role: 'user', text: 'second prompt' },
  ]
  expect(promptsFromMessages(rows).map(p => [p.n, p.text])).toEqual([
    [1, 'first prompt'],
    [2, 'typed while it worked'],
    [3, 'second prompt'],
  ])
})

test('stored prompts are redacted', () => {
  const list = pushPrompt([], { uuid: 'a', text: 'use OPENAI_API_KEY=sk-proj-1234567890abcdef', at: 1 })
  expect(list[0]?.text).not.toContain('1234567890')
  expect(redact('ls -la')).toBe('ls -la')
})

test("prompt text is the typed block, not the context hooks add after it, or a stand-in for an image", () => {
  expect(promptText([{ type: 'text', text: 'hello' }, { type: 'image' }, { type: 'text', text: '<ide-selection>…' }])).toBe('hello')
  expect(promptText([{ type: 'image' }])).toBe('[image]')
  expect(promptText('plain')).toBe('plain')
})

test('a split transcript row maps back to its message', () => {
  const drawn = new Map<string, string>()
  keepRow(drawn, `${UUID.slice(0, 24)}0`)
  keepRow(drawn, UUID)
  keepRow(drawn, `${UUID.slice(0, 24)}1`)
  expect(drawn.get(rowKey(UUID))).toBe(UUID)
  expect(rowKey('not-a-uuid')).toBe('not-a-uuid')
})

test('fit pads and cuts by cells', () => {
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(shorten('abc', 0)).toBe('')
})

// ---------------------------------------------------------------- through the engine

test('prompts land in HISTORY newest first, and a press tries the jump and says why it could not', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })
  await $.session.append(prompt(UUID, 'build the jump spike'))
  await $.session.append(prompt('9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a', 'then the agents'))

  const row = await $.ui.mount({
    plugin: 'glitchdeck',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: UUID,
    props: { text: 'build the jump spike', origin: { kind: 'composer' }, isExpanded: false },
  })
  await row.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(56), surface })
    const rows = await ui.findAll({ type: 'Button', text: /^\s*\d+ {2}/ })
    expect(rows.map(r => r.text.trim().split(/\s+/)[0])).toEqual(['2', '1'])
    expect(await ui.find({ text: /then the agents/ })).toBeDefined()
    // The kit has no transcript to scroll, so the jump fails, and says which prompt it missed.
    await ui.press({ key: 'hist-1' })
    expect(toasts.at(-1)).toMatch(/prompt 1:/)
    await ui.unmount()
  }
})

test('HISTORY pages through older prompts, and a page never runs past the oldest', async ($, on) => {
  mock.clock(on)
  for (let i = 1; i <= 12; i++) await $.session.append(prompt(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `prompt number ${i}`))
  // 12 rows: MAIN with nothing yet is its header, a blank and the files line, the prompts' gap and header take 3, leaving 6: 12-7, then 6-1.
  const ui = await $.ui.mount({ ...pane(56, 12), surface: 'terminal' })
  expect(await ui.find({ key: 'hist-12' })).toBeDefined()
  expect(await ui.find({ key: 'hist-4' })).toBeUndefined()
  await ui.press({ key: 'page-older' })
  await ui.press({ key: 'page-older' })
  expect(await ui.find({ key: 'hist-1' })).toBeDefined()
  expect(await ui.find({ key: 'hist-12' })).toBeUndefined()
  await ui.press({ key: 'page-newer' })
  expect(await ui.find({ key: 'hist-12' })).toBeDefined()
  await ui.unmount()
})

test('a prompt goes back into the box as it was sent, at the cursor, and says so when it cannot', async ($, on) => {
  mock.clock(on)
  const filled: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  let isBlocked = false
  let rows: { role: 'user'; text: string; toolUses: [] }[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => ({ value: rows as never }))
  on('prompt.fill', (_$, e) => {
    if (isBlocked) return { isFilled: false, refusal: 'dialog' as const }
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  const sent = 'use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx\nthen rename the flow columns'
  await $.session.append(prompt('2b1a0f9e-8d7c-4b6a-9594-837261504f3e', sent))
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })

  // The list keeps a masked, one-line copy: with the original gone from the session, nothing goes in.
  await ui.press({ key: 'hist-1~fill' })
  expect(filled).toHaveLength(0)
  expect(toasts.at(-1)).toMatch(/can't reuse prompt 1: its full text is no longer in the session/)

  rows = [{ role: 'user', text: sent, toolUses: [] }]
  await ui.press({ key: 'hist-1~fill' })
  // Inserted, never replaced: a read of the box can come back empty when it was only refused.
  expect(filled).toEqual([{ text: sent, mode: 'insert' }])
  expect(toasts).toHaveLength(1)
  isBlocked = true
  await ui.press({ key: 'hist-1~fill' })
  // A refusal from a hook names no cause, so the toast claims none: only the engine's own says `dialog`.
  expect(toasts.at(-1)).toMatch(/can't reuse prompt 1: the box would not take it/)
  await ui.unmount()
})

test('a prompt is copied as it was sent, from the surface pressed, without jumping, and says so when the clipboard refuses', async ($, on) => {
  mock.clock(on)
  const sent = 'use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx\nthen rename the flow columns'
  const copies: { text: string; surface?: string }[] = []
  const toasts: string[] = []
  let refusal: 'no-clipboard' | undefined
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => ({ value: [{ role: 'user', text: sent, toolUses: [] }] as never }))
  on('ui.copy', (_$, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: refusal ? { isCopied: false as const, reason: refusal } : { isCopied: true as const } }
  })
  await $.session.append(prompt('5c4b3a29-1807-4f6e-8d5c-4b3a29180765', sent))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(60), surface })
    await ui.press({ key: 'hist-1~copy' })
    expect(copies.at(-1)).toEqual({ text: sent, surface })
    await ui.unmount()
  }
  // Only the copy spoke: a press on the row itself would have tried the jump, and said it could not.
  expect(toasts).toEqual(['copied prompt 1', 'copied prompt 1'])

  refusal = 'no-clipboard'
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'hist-1~copy' })
  expect(toasts.at(-1)).toMatch(/can't copy prompt 1: the clipboard took nothing/)
  await ui.unmount()
})
