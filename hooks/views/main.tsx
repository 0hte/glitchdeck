import type { RenderNode } from 'claude-code'

import type { ActivityKind, FileTouch, Main, Todos } from '../../types'
import { fmtClock, fmtMs, plural, prettyModel } from '../core/fmt'
import { runningCalls } from '../core/main'
import { cells, shorten } from '../core/text'
import type { Palette } from '../palette'
import { pastRow, runningRow } from './rows'
import type { Bar, Clock, Els } from './section'
import { blank, line, section } from './section'

const WAITING: Record<ActivityKind, string> = {
  idle: '',
  requesting: 'waiting for the model…',
  thinking: 'thinking…',
  responding: 'writing the answer…',
  'tool-input': 'preparing a tool call…',
  'tool-use': 'running…',
}

/** Rows of what runs right now, or of the last turn's receipt: what the layout calls `now`. */
export const nowRows = (m: Main) => {
  const running = runningCalls(m).length
  return running > 0 ? running : m.isRunning || m.lastTurn ? 1 : 0
}

export const mainSection = (
  els: Els,
  C: Palette,
  W: number,
  d: {
    m: Main
    todos: Todos
    files: readonly FileTouch[]
    clock: Clock
    bar: Bar
    now: number
    /** The throughput graph, three rows, when the layout has room for it. */
    graph: RenderNode | null
    /** Row counts from the pane's layout. */
    pastRows: number
    showTodo: boolean
    showFiles: boolean
  },
): RenderNode => {
  const { Box, Text } = els
  const { m, todos, files, clock } = d
  const a = m.activity

  const running = runningCalls(m)
  const now: RenderNode[] = []
  if (running.length > 0) now.push(...[...running].reverse().map(r => runningRow(els, C, W, r, d)))
  else if (m.isRunning) {
    const words = a.kind === 'tool-input' && a.tool ? `preparing ${a.tool}…` : WAITING[a.kind] || 'working…'
    now.push(
      line(
        els,
        <Box>
          {d.bar('bar-activity', 'live')}
          <Text color={C.hi}>{shorten(words, W - 8)}</Text>
        </Box>,
        clock('activity-clock', a.since, null, C.accent),
      ),
    )
  } else if (m.lastTurn) {
    const t = m.lastTurn
    const isOk = t.reason === 'answer'
    now.push(
      <Text wrap="truncate">
        <Text color={isOk ? C.dim : C.err}>{isOk ? '  ✓ ' : '  ✗ '}</Text>
        <Text color={C.body}>{`last turn ${fmtMs(t.durationMs)}`}</Text>
        <Text color={C.muted}>{` · ${plural(t.tools, 'tool')}`}</Text>
        {t.errors > 0 ? <Text color={C.err}>{` · ${plural(t.errors, 'error')}`}</Text> : null}
        {isOk ? null : <Text color={C.err}>{` · ${t.reason}`}</Text>}
      </Text>,
    )
  }

  const past = m.tools
    .filter(r => !running.includes(r))
    .reverse()
    .slice(0, Math.max(0, d.pastRows))
    .map(r => pastRow(els, C, W, r))

  const extras: RenderNode[] = []
  if (d.showTodo && todos.items.length > 0) {
    const done = todos.items.filter(t => t.status === 'completed').length
    const total = todos.items.length
    const count = `  ${done}/${total}`
    const meterW = Math.max(4, Math.min(34, W - 8 - cells(count)))
    const on = Math.round((done / total) * meterW)
    extras.push(
      <Text wrap="truncate">
        <Text color={C.muted}>{'  todo  '}</Text>
        <Text color={m.isRunning ? C.accent : C.muted}>{'━'.repeat(on)}</Text>
        <Text color={C.faint}>{'─'.repeat(meterW - on)}</Text>
        <Text color={C.body}>{count}</Text>
      </Text>,
    )
    if (todos.active)
      extras.push(
        <Text color={C.body} wrap="truncate">
          {`        ${todos.active}`}
        </Text>,
      )
  }
  if (d.showFiles && files.length > 0) {
    const reads = files.filter(f => f.reads > 0).length
    const edits = files.filter(f => f.edits > 0).length
    extras.push(
      <Text wrap="truncate">
        <Text color={C.muted}>{'  files '}</Text>
        <Text color={C.body}>{`${reads} read · ${edits} edited `}</Text>
        {[...files]
          .reverse()
          .slice(0, 3)
          .map(f => (
            <Text color={f.edits > 0 ? C.body : C.muted}>{`  ${f.path.split('/').pop() ?? f.path}`}</Text>
          ))}
      </Text>,
    )
  }

  // The model's name once it is known; the turn clock beside it while a turn runs.
  const model = m.model ? prettyModel(m.model).toLowerCase() : ''
  const right = m.isRunning ? (
    <Box>
      {model ? <Text color={C.muted}>{`${model} · `}</Text> : null}
      {clock('turn-clock', m.turnStartedAt, null, C.accent)}
    </Box>
  ) : model ? (
    <Text color={C.muted}>{model}</Text>
  ) : undefined
  const rightW = m.isRunning ? (model ? cells(`${model} · `) : 0) + cells(fmtClock(d.now - m.turnStartedAt)) : cells(model)

  return section(els, C, {
    key: 'main',
    W,
    name: (
      <Text color={C.hi} bold>
        main
      </Text>
    ),
    nameW: 4,
    right,
    rightW,
    rows: [...(d.graph ? [d.graph, blank(els)] : []), ...now, ...past, ...(extras.length > 0 ? [blank(els), ...extras] : [])],
  })
}
