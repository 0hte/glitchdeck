import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnStepChunk } from 'claude-code'

import type { ActivityKind, FileTouch, Fx, HistoryEntry, Main, Proc, Timeline, Todos, ToolState, View } from '../types'
import { effectsOf } from './core/effects'
import type { Effect } from './core/effects'
import { closeColumn, credit, flowCols, newFlow, newStream, settle } from './core/flow'
import type { Stream } from './core/flow'
import { fmtClock } from './core/fmt'
import { FRAME_MS, GLITCH_MS } from './core/glitch'
import { allText, attachUuid, keepRow, promptText, promptsFromMessages, promptsFromTranscript, pushPrompt, rowKey, textKey } from './core/history'
import { columnMs } from './core/graph'
import { GRAPH_ROWS, layout } from './core/layout'
import {
  DEFAULT_MAIN,
  DEFAULT_TODOS,
  endTool,
  endTurn,
  kindOfChunk,
  runningCalls,
  setActivity,
  startTool,
  startTurn,
  targetOf,
  todoCreated,
  todoUpdated,
  touchFile,
} from './core/main'
import {
  addProc,
  applyList,
  applyStep,
  callsFromMessages,
  childrenOf,
  detailItems,
  endCall,
  endChildren,
  endMissing,
  endingOf,
  isLive,
  itemHeight,
  newProc,
  setState,
  shortType,
  shownKids,
  startCall,
  topLevel,
  turnEnding,
  withBackfill,
} from './core/procs'
import { BREATH, BREATH_MS, C } from './palette'
import { GRAPH_KEY, GRAPH_MIN_W, graphCells, graphCols, graphView } from './views/graph'
import { HIST_PREFIX, historySection } from './views/history'
import { mainSection, nowRows } from './views/main'
import { PROC_PREFIX, detailSection, itemsSection, listSection, maxProcOffset, procIdOf, secondLine } from './views/procs'
import type { Bar, Clock } from './views/section'

const PANE = 'glitchdeck'
const COLUMNS = 60
const POLL_MS = 3000

const DEFAULT_VIEW: View = { histOffset: 0, agent: '', allProcs: false, procOffset: 0, isClosed: false }

// Each value keeps its own shape tag: bump only the one whose shape changed, and only it reads as absent.
const history = atom({ plugin: 'glitchdeck', key: 'history' } as const, [] as readonly HistoryEntry[], { shape: 'v6' })
const view = atom({ plugin: 'glitchdeck', key: 'view' } as const, DEFAULT_VIEW, { shape: 'v6' })
const main = atom({ plugin: 'glitchdeck', key: 'main' } as const, DEFAULT_MAIN as Main, { shape: 'm9' })
const todos = atom({ plugin: 'glitchdeck', key: 'todos' } as const, DEFAULT_TODOS as Todos, { shape: 'v6' })
const files = atom({ plugin: 'glitchdeck', key: 'files' } as const, [] as FileTouch[], { shape: 'f7' })
const procs = atom({ plugin: 'glitchdeck', key: 'procs' } as const, [] as readonly Proc[], { shape: 'p7' })
const fx = atom({ plugin: 'glitchdeck', key: 'fx' } as const, { frame: 0 } as Fx, { shape: 'v6' })
// A family: one value per process, written alone when that process calls a tool.
const timeline = { plugin: 'glitchdeck', key: 'timeline' } as const

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'glitchdeck', columns: COLUMNS })

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// `update` always writes and redraws its readers; these skip it when the reducer changes nothing.
// One per atom: the engine's scan needs each state call to name its atom directly.
async function patchMain($: EngineInterface, change: (m: Main) => Main) {
  const m = await read($, main)
  if (change(m) !== m) await update($, main, change)
}
async function patchHistory($: EngineInterface, change: (h: readonly HistoryEntry[]) => readonly HistoryEntry[]) {
  const h = await read($, history)
  if (change(h) !== h) await update($, history, change)
}
async function patchView($: EngineInterface, change: (v: View) => View) {
  const v = await read($, view)
  if (change(v) !== v) await update($, view, change)
}
/** Resolves whether a process changed state, so the caller can start the glitch, and which ones the cap let go. */
async function patchProcs($: EngineInterface, change: (p: readonly Proc[]) => readonly Proc[]) {
  const before = await read($, procs)
  if (change(before) === before) return { isChanged: false, gone: [] as string[] }
  const after = await update($, procs, change)
  const kept = new Set(after.map(p => p.id))
  return {
    isChanged: after.some(p => before.find(b => b.id === p.id)?.changedAt !== p.changedAt),
    gone: before.filter(b => !kept.has(b.id)).map(b => b.id),
  }
}

async function isProc($: EngineInterface, id: string) {
  return (await read($, procs)).some(p => p.id === id)
}

// Timers die with the module on a reload; session.start, which fires again, restarts what is needed.
let fxTimer: Timer | undefined
let fxBeat = 0
let glitchUntil = 0
let pollTimer: Timer | undefined
let pollBeat = 0
let graphTimer: Timer | undefined
let graphEvery = 0
let graphBeat = 0
// The graph's columns at the pane's last render, kept while it is away: they share the minute between them.
let graphWidth = graphCols(COLUMNS)
// Whether the pane last drew the graph as a Raster, which the timer scrolls between redraws.
let isGraphDrawn = false
// What every response of the session streamed, a column per tick, and the responses streaming now.
let flow = newFlow()
const streams = new Set<Stream>()
// False only while the pane's last render had no flow to draw: the first column then redraws it, once.
let isFlowDrawn = true

/** A refused period ends an interval without a word: one that has not beaten lately is started again. */
const isStale = (beat: number, now: number, ms: number) => now - beat > ms * 3

const stopFx = () => {
  fxTimer?.cancel()
  fxTimer = undefined
}
const stopPoll = () => {
  pollTimer?.cancel()
  pollTimer = undefined
}
const stopGraph = () => {
  graphTimer?.cancel()
  graphTimer = undefined
}

/** Redraws the rows every frame while a state change is still glitching, then stops. */
async function kickFx($: EngineInterface) {
  const now = await $.clock.now()
  glitchUntil = now + GLITCH_MS
  if (fxTimer && !isStale(fxBeat, now, FRAME_MS)) return
  stopFx()
  fxBeat = now
  fxTimer = $.clock.every(FRAME_MS, () => void fxFrame($).catch(stopFx))
}

async function fxFrame($: EngineInterface) {
  const now = await $.clock.now()
  fxBeat = now
  if (now > glitchUntil) stopFx()
  await update($, fx, f => ({ frame: f.frame + 1 }))
}

async function changeProcs($: EngineInterface, change: (p: readonly Proc[]) => readonly Proc[]) {
  const { isChanged, gone } = await patchProcs($, change)
  // State has no delete: a process the cap let go keeps an empty timeline.
  for (const id of gone) await $.state.set({ ...timeline, id }, { calls: [], total: 0 })
  if (isChanged) await kickFx($)
}

/** Agents end without a notification when they run in the foreground: the list says so. */
async function pollAgents($: EngineInterface) {
  const [list, agents, now] = await Promise.all([read($, procs), $.agent.list(), $.clock.now()])
  pollBeat = now
  await changeProcs($, ps => applyList(ps, agents, now))
  if (!list.some(p => p.kind === 'agent' && isLive(p)) && !agents.some(a => a.status === 'running')) stopPoll()
}

function ensurePoll($: EngineInterface, now: number) {
  if (pollTimer && !isStale(pollBeat, now, POLL_MS)) return
  stopPoll()
  pollBeat = now
  pollTimer = $.clock.every(POLL_MS, () => void pollAgents($).catch(stopPoll))
}

/** Agents stream tokens; shells and monitors do not. */
const isStreamer = (p: Proc) => isLive(p) && p.kind !== 'shell' && p.kind !== 'monitor'

/** Whether anything can still stream: the graph keeps scrolling while it can, and freezes gray after. */
const isFlowing = (m: Main, ps: readonly Proc[]) => m.isRunning || streams.size > 0 || ps.some(isStreamer)

/** While anything runs, the graph closes a column per tick, drawn or not, so it always shows the last minute. */
async function startGraph($: EngineInterface) {
  const every = columnMs(graphWidth)
  const now = await $.clock.now()
  if (graphTimer && graphEvery === every && !isStale(graphBeat, now, every)) return
  stopGraph()
  graphEvery = every
  graphBeat = now
  graphTimer = $.clock.every(every, () => void tickGraph($).catch(() => undefined))
}

async function tickGraph($: EngineInterface) {
  for (const s of streams) credit(flow, s)
  closeColumn(flow, graphEvery)
  const [m, ps, now] = await Promise.all([read($, main), read($, procs), $.clock.now()])
  graphBeat = now
  const isLiveNow = isFlowing(m, ps)
  if (isGraphDrawn) await $.ui.blit({ requestId: PANE, key: GRAPH_KEY, cells: graphCells(C, { flow, isLive: isLiveNow }, graphWidth) })
  else if (!isFlowDrawn && flow.cols.length > 0) {
    isFlowDrawn = true
    await patchMain($, x => ({ ...x, flow: flowCols(flow) }))
  }
  if (!isLiveNow) {
    stopGraph()
    // Kept for a reload, which starts the module, and so the flow, over.
    await patchMain($, x => ({ ...x, flow: flowCols(flow) }))
  } else if (columnMs(graphWidth) !== graphEvery) await startGraph($)
}

/** A response starts streaming: its text counts toward the graph from its first piece. */
const openStream = ($: EngineInterface) => {
  const s = newStream(flow)
  streams.add(s)
  void startGraph($).catch(() => undefined)
  return s
}

const countChunk = (s: Stream, c: TurnStepChunk) => {
  if (c.kind === 'text' || c.kind === 'thinking') s.chars += c.text.length
  else if (c.kind === 'input') s.chars += c.json.length
}

async function applyEffect($: EngineInterface, x: Effect, now: number) {
  if (x.kind === 'file') await update($, files, list => touchFile(list, x, x.isEdit, now))
  else if (x.kind === 'proc') await changeProcs($, ps => addProc(ps, x.proc))
  else if (x.kind === 'stop') await changeProcs($, ps => setState(ps, x.id, 'Z', 'killed', now))
  else if (x.kind === 'todos') await update($, todos, () => x.todos)
  else if (x.kind === 'todo-created') await update($, todos, t => todoCreated(t, x))
  else await update($, todos, t => todoUpdated(t, x))
}

/** Everything this session showed, but the model's name and whether the person closed the pane. */
async function resetSession($: EngineInterface) {
  stopGraph()
  flow = newFlow()
  streams.clear()
  await update($, history, () => [])
  await update($, view, v => ({ ...DEFAULT_VIEW, isClosed: v.isClosed }))
  await update($, main, m => ({ ...DEFAULT_MAIN, model: m.model }))
  await update($, todos, () => DEFAULT_TODOS)
  await update($, files, () => [])
  for (const p of await read($, procs)) await $.state.set({ ...timeline, id: p.id }, { calls: [], total: 0 })
  await update($, procs, () => [])
}

export const register: Register = (on, options) => {
  // Transcript row ids as drawn, by rowKey. Rebuilt as rows redraw after a reload.
  const drawn = new Map<string, string>()
  // The same rows by their text, for prompts read back without an id.
  const drawnByText = new Map<string, string>()
  // Agents whose conversation was read back since this load, so a press reads it once.
  const backfilled = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'glitchdeck',
      description: 'Toggle the glitchdeck pane: what Claude is doing, its agents and your prompts',
      argumentHint: '[open|close]',
      immediate: true,
    })
    const [model, m, now] = await Promise.all([$.session.model().catch(() => ''), read($, main), $.clock.now()])
    if (model) await patchMain($, x => (x.model === model ? x : { ...x, model }))
    if (flow.cols.length === 0) flow = newFlow(m.flow)
    if (m.isRunning) await startGraph($)
    // Picks up agents already running when the mod (re)loads.
    await pollAgents($).catch(() => undefined)
    if ((await read($, procs)).some(isLive)) ensurePoll($, now)
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (options.openOnStart !== false && !isOpen && !(await read($, view)).isClosed) void openPane($).catch(() => undefined)
    return started
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) {
      // Nothing is drawn while the pane is away: the glitch waits for it; the graph keeps counting.
      stopFx()
      isGraphDrawn = false
      isFlowDrawn = true
      if (e.origin.kind === 'person') await patchView($, v => (v.isClosed ? v : { ...v, isClosed: true }))
    }
    return closed
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetSession($)
      drawn.clear()
      drawnByText.clear()
      backfilled.clear()
    }
    return next(e)
  })

  // A resumed or forked session loads its rows without appending them, so its prompts come from the file.
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)
    if (e.source === 'resume' || e.source === 'fork') {
      await resetSession($)
      drawn.clear()
      drawnByText.clear()
      backfilled.clear()
      // The file has ids and times; past 4 MiB it cannot be read, and the session's newest messages stand in.
      const text = await $.fs.read(e.transcript_path).catch(() => null)
      const rows = typeof text === 'string' ? null : await $.session.messages().catch(() => null)
      const seeded = typeof text === 'string' ? promptsFromTranscript(text) : Array.isArray(rows) ? promptsFromMessages(rows) : null
      if (seeded) await update($, history, () => seeded)
      else $.ui.toast("glitchdeck couldn't read this session's earlier prompts")
    }
    return done
  }).catch(($, e, next) => next(e))

  // At a stop the engine lists the background work still in flight; whatever ran here and is gone
  // from that list has ended, even if its notification reached no hook.
  on('classic.Stop', async ($, e, next) => {
    const done = await next(e)
    const listed = e.background_tasks
    // An absent list says nothing about what still runs.
    if (listed) {
      const inFlight = new Set(listed.map(t => t.id))
      const now = await $.clock.now()
      await changeProcs($, ps => endMissing(ps, inFlight, now))
    }
    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'glitchdeck' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
    const mine = (await $.ui.panes()).find(p => p.id === PANE)
    if (verb === 'close' || (verb !== 'open' && mine?.isShown)) {
      await $.ui.close({ id: PANE })
      stopFx()
      isGraphDrawn = false
      isFlowDrawn = true
      await patchView($, v => (v.isClosed ? v : { ...v, isClosed: true }))
      return {}
    }
    await patchView($, v => (v.isClosed ? { ...v, isClosed: false } : v))
    if ((await read($, main)).isRunning) await startGraph($)
    const opened = await openPane($)
    return opened.isPlaced ? {} : { text: `glitchdeck is waiting for room: ${opened.reason}` }
  })

  // ---------------------------------------------------------------- loops

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, main, m => startTurn(m, now))
    await startGraph($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    const stream = openStream($)
    try {
      const s = next(e)
      if (agentId) {
        for await (const c of s) {
          yield c
          countChunk(stream, c)
        }
        const result = await s.result
        settle(flow, stream, result.usage?.output_tokens)
        const now = await $.clock.now()
        await changeProcs($, ps => applyStep(ps, agentId, { usage: result.usage, answer: result.answer, now }))
        return result
      }
      const model = e.model
      await patchMain($, m => (m.model === model ? m : { ...m, model }))
      let shown: ActivityKind | undefined
      for await (const c of s) {
        yield c
        // The bookkeeping follows each piece, so no piece waits on it: characters are only counted, and
        // the clock is read on a change of kind, not per token chunk.
        countChunk(stream, c)
        const kind = kindOfChunk(c.kind)
        if (kind !== undefined && kind !== shown) {
          shown = kind
          const now = await $.clock.now()
          const tool = c.kind === 'tool' ? c.name : ''
          await patchMain($, m => setActivity(m, { kind, tool, target: '' }, now))
        }
      }
      const result = await s.result
      settle(flow, stream, result.usage?.output_tokens)
      return result
    } finally {
      streams.delete(stream)
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const tool = String(e.tool)
    const agentId = e.agentId
    // The call runs while its row is written: nothing waits on the bookkeeping.
    const running = next(e)
    running.catch(() => undefined)
    const target = targetOf(tool, e)
    const [startedAt, isTracked] = await Promise.all([$.clock.now(), agentId === undefined ? false : isProc($, agentId)])
    const row = { id, tool, target, startedAt }
    if (agentId === undefined) await update($, main, m => startTool(m, row))
    else if (isTracked) await update($, { ...timeline, id: agentId }, t => startCall(t, row))
    const settle = async (state: ToolState) => {
      const now = await $.clock.now()
      if (agentId === undefined) await update($, main, m => endTool(m, id, state, now))
      else if (isTracked) await update($, { ...timeline, id: agentId }, t => endCall(t, id, state, now))
      return now
    }
    let ran: Awaited<typeof running>
    try {
      ran = await running
    } catch (err) {
      await settle('err')
      throw err
    }
    const state: ToolState = ran.deny !== undefined ? 'deny' : ran.isError ? 'err' : 'ok'
    const now = await settle(state)
    if (state !== 'ok') return ran
    for (const x of effectsOf({ tool, input: e, result: ran.result, agentId, now })) await applyEffect($, x, now)
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const now = await $.clock.now()
    const runId = e.workflow?.runId ?? ''
    const agent = newProc({
      id: started.agentId,
      kind: runId ? 'wfagent' : 'agent',
      type: shortType(e.subagentType),
      task: e.description,
      now,
      parent: runId || e.parentAgentId || '',
    })
    await changeProcs($, ps => {
      // A workflow's agents can start before its Workflow call has answered: hold a place for the run.
      const withRun = runId && !ps.some(p => p.id === runId) ? addProc(ps, newProc({ id: runId, kind: 'workflow', type: 'workflow', task: '', now })) : ps
      return addProc(withRun, agent)
    })
    if (!runId) ensurePoll($, now)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const now = await $.clock.now()
    const agentId = e.agentId
    if (agentId === undefined) {
      const t = { durationMs: e.durationMs, reason: e.reason }
      await update($, main, m => endTurn(m, now, t))
    } else {
      const end = turnEnding(e.reason)
      await changeProcs($, ps => endChildren(setState(ps, agentId, end.state, end.why, now), agentId, now))
    }
    return done
  })

  // ---------------------------------------------------------------- rows: prompts and notifications

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const kind = e.origin.kind
    const words = allText(e.message.content)
    if (e.agentId === undefined && e.door === 'prompt' && (kind === 'composer' || kind === 'bridge')) {
      const text = promptText(e.message.content)
      const at = await $.clock.now()
      await patchHistory($, list => {
        const named = attachUuid(list, text, e.uuid, true)
        return named !== list ? named : pushPrompt(list, { uuid: e.uuid, text, at })
      })
      await patchView($, v => (v.histOffset === 0 ? v : { ...v, histOffset: 0 }))
    } else if (e.agentId === undefined && e.door === 'attachment' && e.message.name === 'queued_command' && !words.includes('<task-notification>')) {
      // A prompt typed mid-turn reaches the model inside the engine's framing of it.
      await patchHistory($, list => attachUuid(list, words, e.uuid, false))
    }
    if (e.door === 'prompt' || e.door === 'attachment' || e.door === 'delivery') {
      // A notification is its own prompt row when the session is idle, and an attachment folded into
      // the running turn (origin `engine`) otherwise; it reaches a subagent's loop when that agent started the task.
      const ending = endingOf(words)
      if (ending) {
        const now = await $.clock.now()
        await changeProcs($, ps => setState(ps, ending.taskId, ending.state, ending.why, now))
      }
    }
    return stored
  }).catch(($, e, next) => next(e))

  // A prompt typed at idle is kept from its row, which session.append sees before this resolves; one
  // typed over a running turn reaches the model inside that turn, so it is taken here. Slash commands do not count.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    const kind = e.origin.kind
    const text = entered.drop === undefined ? entered.text : ''
    if (e.turnId !== undefined && (kind === 'composer' || kind === 'bridge') && text.trim() !== '' && !text.trim().startsWith('/')) {
      const at = await $.clock.now()
      await patchHistory($, list => pushPrompt(list, { uuid: '', text, at }))
      await patchView($, v => (v.histOffset === 0 ? v : { ...v, histOffset: 0 }))
    }
    return entered
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const kind = e.props.origin.kind
    if (kind === 'composer' || kind === 'bridge') {
      keepRow(drawn, e.requestId)
      const key = textKey(e.props.text)
      if (!drawnByText.has(key)) drawnByText.set(key, e.requestId)
    }
    return next(e)
  })

  // The transcript scrolls only while answering the person's own press, so the jump runs here,
  // inside the press dispatch, not in the Button's onPress closure. Opening an agent reads its
  // conversation back once, for the calls it made before the mod loaded.
  on('ui.press', { plugin: 'glitchdeck' }, async ($, e, next) => {
    if (e.element.startsWith(HIST_PREFIX)) {
      const n = Number(e.element.slice(HIST_PREFIX.length))
      const entry = (await read($, history)).find(p => p.n === n)
      if (entry) await jumpTo($, entry, drawn, drawnByText)
    } else if (e.element.startsWith(PROC_PREFIX)) {
      const id = procIdOf(e.element)
      const p = (await read($, procs)).find(x => x.id === id)
      if (p?.kind === 'agent' && !backfilled.has(id)) {
        backfilled.add(id)
        const rows = await $.session.messages({ agentId: id }).catch(() => null)
        if (Array.isArray(rows)) {
          const back = callsFromMessages(rows, isLive(p), targetOf)
          if (back.length > 0) await update($, { ...timeline, id }, t => withBackfill(t, back))
        }
      }
    }
    return next(e)
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const [m, t, f, hist, v, ps, , now] = await Promise.all([
      read($, main),
      read($, todos),
      read($, files),
      read($, history),
      read($, view),
      read($, procs),
      // Read so a glitch frame redraws the pane; the frame itself is computed from the clock.
      read($, fx),
      $.clock.now(),
    ])
    const Client = 'Client' in els ? els.Client : undefined
    // Other surfaces list a Raster but draw it as nothing, so they get the braille graph.
    const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : undefined
    const clock: Clock = (key, since, endAt, color) =>
      since <= 0 ? (
        <els.Text color={color}>—</els.Text>
      ) : Client ? (
        <Client key={key} module="./clients/elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <els.Text color={color}>{fmtClock((endAt ?? now) - since)}</els.Text>
      )
    const bar: Bar = (key, tone, rows = 1) => {
      if (tone === 'live' && Client) return <Client key={key} module="./clients/breathe.tsx" props={{ colors: BREATH, glyph: '▎', rows, ms: BREATH_MS, now }} />
      return (
        <els.Box flexDirection="column" flexShrink={0}>
          {Array.from({ length: rows }, () =>
            tone === 'none' ? <els.Text> </els.Text> : <els.Text color={tone === 'err' ? C.err : C.accent}>▎</els.Text>,
          )}
        </els.Box>
      )
    }

    // The body's own width: never wider, or the pane would draw past its frame.
    const W = Math.max(1, e.props.bodyColumns)
    const opened = v.agent ? ps.find(p => p.id === v.agent) : undefined
    const top = topLevel(ps)

    // Reading a timeline while drawing subscribes the pane to it: only the opened process's, its live
    // agents', and those of the live processes the short list can show are read.
    const wanted = new Set<string>()
    if (opened) {
      wanted.add(opened.id)
      for (const k of childrenOf(ps, opened.id)) if (isLive(k)) wanted.add(k.id)
    } else if (!v.allProcs)
      for (const p of top.filter(isLive)) {
        wanted.add(p.id)
        if (p.kind === 'workflow') for (const k of shownKids(ps, p.id).shown) if (isLive(k)) wanted.add(k.id)
      }
    const read2 = await Promise.all([...wanted].map(async id => [id, await read($, { ...timeline, id })] as const))
    const calls = new Map<string, Timeline>()
    for (const [id, tl] of read2) if (tl) calls.set(id, tl)
    const own = opened ? calls.get(opened.id) : undefined

    const L = layout({
      rows: e.props.scroll.bodyRows,
      main: {
        now: nowRows(m),
        past: m.tools.length - runningCalls(m).length,
        hasTodo: t.items.length > 0,
        hasActive: t.active !== '',
        hasFiles: f.length > 0,
        hasGraph: flow.cols.length > 0 && W >= GRAPH_MIN_W,
      },
      procs:
        ps.length === 0
          ? null
          : {
              items: top.map(p => (v.allProcs ? 1 : itemHeight(p, ps, secondLine(p, calls.get(p.id)) !== ''))),
              detail: opened ? detailItems(opened, ps, own?.calls ?? []) : null,
              isList: v.allProcs,
            },
      history: hist.length,
    })

    const raster = Raster ? (cols: number, cells: string) => <Raster key={GRAPH_KEY} columns={cols} rows={GRAPH_ROWS} cells={cells} /> : undefined
    if (W >= GRAPH_MIN_W) graphWidth = graphCols(W)
    isGraphDrawn = L.showGraph && raster !== undefined
    isFlowDrawn = flow.cols.length > 0
    const graph = L.showGraph ? graphView(els, C, W, { g: { flow, isLive: isFlowing(m, ps) }, raster }) : null

    const maxHist = Math.max(0, hist.length - L.histRows)
    const offset = Math.min(v.histOffset, maxHist)
    const page = (delta: number) => () =>
      void patchView($, x => {
        const o = clamp(x.histOffset + delta, 0, maxHist)
        return o === x.histOffset ? x : { ...x, histOffset: o }
      })
    const maxProcs = maxProcOffset(ps, L.listRows)
    const pageProcs = (delta: number) => () =>
      void patchView($, x => {
        const o = clamp(x.procOffset + delta, 0, maxProcs)
        return o === x.procOffset ? x : { ...x, procOffset: o }
      })
    const openProc = (id: string) => () => void update($, view, x => ({ ...x, agent: x.agent === id ? '' : id }))
    const back = () => void update($, view, x => ({ ...x, agent: '' }))
    const toggleAll = () => void update($, view, x => ({ ...x, allProcs: !x.allProcs, procOffset: 0 }))
    const shared = { list: ps, calls, now, clock, bar, onOpen: openProc, onAll: toggleAll }

    return (
      <els.Box flexDirection="column" width={W}>
        {mainSection(els, C, W, { m, todos: t, files: f, clock, bar, now, graph, pastRows: L.pastRows, showTodo: L.showTodo, showFiles: L.showFiles })}
        {L.procMode === 'detail' && opened
          ? detailSection(els, C, W, { ...shared, proc: opened, own, rows: L.detailRows, onBack: back })
          : L.procMode === 'list'
            ? listSection(els, C, W, { ...shared, rows: L.listRows, offset: Math.min(v.procOffset, maxProcs), onPage: pageProcs })
            : L.procMode === 'items'
              ? itemsSection(els, C, W, { ...shared, items: L.procItems })
              : null}
        {hist.length > 0
          ? historySection(els, C, W, { list: hist, offset, rows: L.histRows, onNewer: page(-L.histRows), onOlder: page(L.histRows) })
          : null}
      </els.Box>
    )
  })
}

async function jumpTo($: EngineInterface, entry: HistoryEntry, drawn: Map<string, string>, drawnByText: Map<string, string>) {
  const byId = entry.uuid ? [drawn.get(rowKey(entry.uuid)), entry.uuid] : []
  const targets = [...new Set([...byId, drawnByText.get(entry.text)].filter((t): t is string => t !== undefined && t !== ''))]
  let why = 'not drawn yet'
  for (const requestId of targets) {
    const moved = await $.ui
      .scroll({ to: { requestId }, block: 'start' })
      .catch((err: unknown) => ({ deny: err instanceof Error ? err.message : 'scroll failed' }))
    if (moved.deny === undefined) return
    why = moved.deny
  }
  $.ui.toast(`can't jump to prompt ${entry.n}: ${why}`)
}
