import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { glitchText } from '../hooks/core/glitch'
import { attachUuid, originalOf, pushPrompt } from '../hooks/core/history'
import { DEFAULT_TODOS, todoCreated, todoUpdated, todosFromWrite } from '../hooks/core/main'
import { cells, oneLine, redact, shorten, wrapLines } from '../hooks/core/text'
import { pane, promptRow, spawn } from './kit'

// ---------------------------------------------------------------- pure behavior

test('the in-progress todo shows its words while it runs and clears when it is done', () => {
  const w = todosFromWrite([{ content: 'Ship it', status: 'in_progress', activeForm: '' }])
  expect(w.active).toBe('Ship it')
  let t = todoCreated(DEFAULT_TODOS, { id: '7', subject: 'Write tests' })
  t = todoUpdated(t, { taskId: '7', status: 'in_progress', activeForm: '' })
  expect(t.active).toBe('Write tests')
  t = todoUpdated(t, { taskId: '7', status: 'completed' })
  expect(t.active).toBe('')
})

test('a prompt taken at submit gets its row id once, exactly or inside the framing of a mid-turn delivery', () => {
  let list = pushPrompt([], { uuid: '', text: 'fix the build', at: 1 })
  list = pushPrompt(list, { uuid: '', text: 'and the tests', at: 2 })
  list = attachUuid(list, 'fix the build', 'u1', true)
  list = attachUuid(list, 'The user sent a message while you were working: and the tests. Address it.', 'u2', false)
  expect(list.map(p => [p.n, p.uuid])).toEqual([
    [1, 'u1'],
    [2, 'u2'],
  ])
  expect(attachUuid(list, 'fix the build', 'u1', true)).toBe(list)
})

test('a prompt typed mid-turn is reused from the framing that carried it, even in the row of a tool result', () => {
  const sent = 'and the tests\n\nboth suites'
  const framed = (who: string) =>
    `<system-reminder>\n${who} while you were working:\n${sent}\n\nThis is how Claude Code surfaces messages the user sends mid-turn. Address the message above as you continue this turn.\n</system-reminder>`
  const entry = pushPrompt([], { uuid: '', text: sent, at: 1 })[0]!
  expect(originalOf([{ role: 'user', text: framed('The user sent a new message'), toolResults: [{}] }], entry)).toBe(sent)
  expect(originalOf([{ role: 'user', text: framed('Another Claude session sent a message'), toolResults: [{}] }], entry)).toBeNull()
})

test('wide glyphs and emoji are measured in cells, and long words wrap at spaces', () => {
  expect(cells('日本語')).toBe(6)
  expect(cells('ship 🚀')).toBe(7)
  expect(cells('👍🏽')).toBe(2)
  expect(cells('e\u0301')).toBe(1)
  expect(cells(shorten('日本語のテキストです', 7))).toBeLessThanOrEqual(7)
  expect(cells(glitchText('日本語 map', 'x', 1000, 1100))).toBe(cells('日本語 map'))
  expect(wrapLines('register.tsx wires every event to a pure reducer in core', 20, 2)).toEqual(['register.tsx wires', 'every event to a pu…'])
  expect(wrapLines('short', 20, 2)).toEqual(['short'])
})

// Built in pieces so no scanner mistakes the fixtures for real keys.
const k = (...parts: string[]) => parts.join('')

test('credentials of every common shape are masked', () => {
  const cases: [string, string][] = [
    [k('AKIA', 'IOSFODNN7EXAMPLE'), 'IOSFODNN7EXAMPLE'],
    [k('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0In0', '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), 'dozjgNryP4J3'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
    ['-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----', 'lQOYBF'],
    [k('AIza', 'SyA-1234567890abcdefghijklmnopqrstu'), '1234567890abc'],
    ['{"password":"hunter2"}', 'hunter2'],
    ["{'api_key': 'zx81spectrum'}", 'zx81spectrum'],
    ['"Authorization": "Basic dXNlcjpwYXNz"', 'dXNlcjpwYXNz'],
    ['curl -H "Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b" https://api', '9944b091'],
    ['Authorization: AWS4-HMAC-SHA256 Credential=AKID/2026, Signature=fe5f80f77d5fa3be', 'fe5f80f77d5f'],
    ['echo "DB_PASS=s3cr3tvalue" >> .env', 's3cr3tvalue'],
    ['export MYAPP_CREDENTIALS=c4fe-b4be', 'c4fe-b4be'],
    ['mysql -u root -phunter22 mydb', 'hunter22'],
    ['sshpass -p letmein22 ssh host', 'letmein22'],
    ['curl -u admin:opensesame https://x', 'opensesame'],
    ['tool --auth-token tok123456 run', 'tok123456'],
    ['Cookie: session=abc123def456', 'abc123def456'],
    ['https://bucket.s3.amazonaws.com/f?X-Amz-Signature=aa11bb22cc33&X-Amz-Date=1', 'aa11bb22cc33'],
    ['https://x.blob.core.windows.net/c?sv=1&sig=QmFzZTY0U2ln', 'QmFzZTY0U2ln'],
    ['DefaultEndpointsProtocol=https;AccountName=x;AccountKey=bXlrZXk9PQ==;', 'bXlrZXk9PQ'],
    [k('ghu_', 'aaaaBBBBccccDDDDeeee1234'), 'aaaaBBBBcccc'],
    [k('glpat-', 'xxxxYYYYzzzz11112222'), 'xxxxYYYYzzzz'],
    [k('npm_', 'abcdefghijklmnopqrstuvwxyz0123456789'), 'abcdefghijklmnop'],
    [k('hf_', 'abcdefghijklmnopqrstuvwxyzABCDEFGH'), 'abcdefghijklmnop'],
    [k('ya29.', 'a0AfH6SMBxxxxxxxxxxxxxxxx'), 'a0AfH6SMB'],
    ['postgres://app:pa55word@db:5432/x', 'pa55word'],
  ]
  for (const [text, secret] of cases) expect(redact(`use ${text} now`), text).not.toContain(secret)
  for (const plain of ['ls -la', 'npm run build', 'max_tokens: 400', 'monkey=1', 'git log --oneline']) expect(redact(plain)).toBe(plain)
})

test('the credential patterns stay linear on hostile input', () => {
  const start = Date.now()
  for (const s of ['a.'.repeat(60_000), 'eyJ-'.repeat(30_000), 'x_'.repeat(60_000), `mysql ${'a'.repeat(100_000)}`]) redact(s)
  expect(Date.now() - start).toBeLessThan(1000)
})

test('control characters, escape sequences and direction overrides never reach the screen', () => {
  expect(oneLine('\u001b[31mred\u001b[0m and a bell\u0007 \u001b]8;;https://x\u0007link\u001b]8;;\u0007')).toBe('red and a bell link')
  expect(oneLine('evil\u202Egnp.exe \u0085next \u009b2Jdone')).toBe('evilgnp.exe next done')
})

// ---------------------------------------------------------------- through the engine

const engine = (on: On) => {
  mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `ag${++n}` }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
}

const UUID = '3f2a9c1e-7b1d-4e0a-9c2f-1a2b3c4d5e6f'

test('a prompt typed at idle is one entry: its row comes before its submit resolves', async ($, on) => {
  engine(on)
  await $.session.append(promptRow(UUID, 'only once'))
  await $.prompt.submit({ text: 'only once', origin: { kind: 'composer' }, wait: false } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button', text: /only once/ })).toHaveLength(1)
  await ui.unmount()
})

test('a prompt typed mid-turn lands in HISTORY once, with the row that delivers it; a slash command does not', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.append(promptRow(UUID, 'first, at idle'))
  await $.prompt.submit({ text: 'second, mid-turn', origin: { kind: 'composer' }, wait: false, turnId: 'T1' } as never).catch(() => undefined)
  await $.session.append({
    message: { type: 'attachment' as const, name: 'queued_command', content: [{ type: 'text' as const, text: 'The user sent: second, mid-turn' }] },
    door: 'attachment' as const,
    origin: { kind: 'engine' } as never,
    uuid: '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a',
  }).catch(() => undefined)
  await $.prompt.submit({ text: '/compact', origin: { kind: 'composer' }, wait: false, turnId: 'T1' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button', text: /second, mid-turn/ })).toHaveLength(1)
  expect(await ui.find({ text: /first, at idle/ })).toBeDefined()
  expect(await ui.find({ text: /\/compact/ })).toBeUndefined()
  expect(await ui.find({ key: 'hist-2' })).toBeDefined()
  expect(await ui.find({ key: 'hist-3' })).toBeUndefined()
  // It took the delivering row's id, so the jump has a row to try; the kit has no transcript to reach it.
  await ui.press({ key: 'hist-2' })
  expect(toasts.at(-1)).toMatch(/prompt 2:/)
  expect(toasts.at(-1)).not.toMatch(/not drawn yet/)
  await ui.unmount()
})

test('a prompt holding escape codes or a bell still draws, cleaned', async ($, on) => {
  engine(on)
  await $.session.append(promptRow(UUID, 'look at \u001b[31mthis\u001b[0m log\u0007'))
  await $.tool.call({ tool: 'Bash', command: 'printf "\u001b[2J"; echo done' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /look at this log/ })).toBeDefined()
  await ui.unmount()
})

test('hidden processes are one press away, either line of a live agent opens it, and paging stops at the ends', async ($, on) => {
  engine(on)
  for (let i = 1; i <= 8; i++) await $.agent.spawn(spawn('Explore', `task ${i}`))
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag2' } as never)
  // 12 rows: MAIN's header, blank and files line, the gap and header, five processes and the way back.
  const ui = await $.ui.mount({ ...pane(60, 12), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-ag8' })).toBeUndefined()
  await ui.press({ key: 'procs-all' })
  expect(await ui.find({ key: 'proc-ag1' })).toBeDefined()
  for (let i = 0; i < 4; i++) await ui.press({ key: 'procs-down' })
  expect(await ui.find({ key: 'proc-ag8' })).toBeDefined()
  // Presses past the last page went nowhere, so one press back is the first page again.
  await ui.press({ key: 'procs-up' })
  expect(await ui.find({ key: 'proc-ag1' })).toBeDefined()
  await ui.press({ key: 'procs-all' })
  expect(await ui.find({ key: 'proc-ag8' })).toBeUndefined()
  await ui.press({ key: 'proc-ag2~last' })
  expect(await ui.find({ key: 'procs-back' })).toBeDefined()
  expect(await ui.find({ text: /task 2/ })).toBeDefined()
  await ui.unmount()
})

test("MAIN's files line counts the main loop only", async ($, on) => {
  engine(on)
  await $.agent.spawn(spawn('Explore', 'read things'))
  await $.tool.call({ tool: 'Read', file_path: '/repo/sub.ts', agentId: 'ag1' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ text: /^ *files 0 read · 0 edited · 0 created · 0 deleted$/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/repo/main.ts' } as never)
  const after = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  // Counts alone, every category even at zero, and no file named.
  expect(await after.find({ text: /^ *files 1 read · 0 edited · 0 created · 0 deleted$/ })).toBeDefined()
  await after.unmount()
})

test('an in-session /resume starts MAIN and PROCS over', async ($, on) => {
  engine(on)
  await $.agent.spawn(spawn('Explore', 'old work'))
  await $.tool.call({ tool: 'Read', file_path: '/repo/main.ts' } as never)
  await $.classic.SessionStart({ source: 'resume', transcript_path: 'C:\\nowhere.jsonl' } as never)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await ui.find({ key: 'proc-ag1' })).toBeUndefined()
  expect(await ui.find({ text: /files 0 read/ })).toBeDefined()
  await ui.unmount()
})
