import type { RenderNode } from 'claude-code'

import type { Proc, ProcKind, Timeline, ToolRow } from '../../types'
import { fmtClock, fmtWall, plural } from '../core/fmt'
import { glitchText } from '../core/glitch'
import { childrenOf, isLive, kTokens, shownKids, topLevel, totalOf } from '../core/procs'
import { cells, fit, shorten, wrapLines } from '../core/text'
import type { Palette } from '../palette'
import { pastRow, runningRow } from './rows'
import type { Bar, Clock, Els, Fold, Tone } from './section'
import { STOP, blank, control, line, section } from './section'

export const PROC_PREFIX = 'proc-'
const BACK_KEY = 'procs-back'
export const STOP_SUFFIX = '~stop'

/** A process's id from any of its buttons' keys (`proc-<id>` or `proc-<id>~part`). */
export const procIdOf = (element: string) => element.slice(PROC_PREFIX.length).split('~')[0] ?? ''

/** TaskStop needs a task id: a foreground agent has none of its own, and a workflow's agents end with their run. */
export const canStop = (p: Proc) =>
  isLive(p) &&
  p.taskId !== '' &&
  (p.kind === 'shell' || p.kind === 'monitor' || p.kind === 'workflow' || (p.kind === 'agent' && p.parent === '' && p.isBackground === true))

const TYPE_W = 10
const KID_W = 8

/** The column every row opens with, so an agent, a background command and a run never read alike. */
const KIND: Record<ProcKind, string> = { agent: 'agent', wfagent: 'agent', shell: 'shell', monitor: 'monitor', workflow: 'workflow' }

/** An agent is told from the others of its kind by its type; a command or a run by its own text. */
const rowText = (p: Proc) => (p.kind === 'agent' || p.kind === 'wfagent' ? [p.type.toLowerCase(), p.task].filter(Boolean).join(' · ') : p.task || p.type)

const toneOf = (p: Proc): Tone => (p.state === 'R' ? 'live' : p.state === 'S' ? 'wait' : p.state === 'Z' ? 'err' : 'none')

const lastCall = (calls: readonly ToolRow[]) => {
  const c = calls[calls.length - 1]
  return c ? `${c.tool} ${c.target}` : ''
}

/** What a live agent's second line says: its last call, or failing that its last words; '' leaves it out. */
export const secondLine = (p: Proc, t: Timeline | undefined) => lastCall(t?.calls ?? []) || p.lastText

type Shared = {
  list: readonly Proc[]
  /** Timelines of the live processes drawn, by id. */
  calls: ReadonlyMap<string, Timeline>
  now: number
  clock: Clock
  bar: Bar
  onOpen: (id: string) => () => void
  onAll: () => void
  onStop: (id: string) => () => void
  fold: Fold
}

/** The right side of a process row: why it waits or ended, then its clock, in the accent while it runs. */
const status = (els: Els, C: Palette, p: Proc, d: Shared) => {
  const { Box, Text } = els
  const word = p.state === 'S' ? 'waiting' : p.state === 'X' ? 'done' : p.state === 'Z' ? p.why || 'failed' : ''
  const wordColor = p.state === 'S' ? C.accent : p.state === 'Z' ? C.err : C.dim
  const time = p.startedAt > 0 ? fmtClock((p.endedAt ?? d.now) - p.startedAt) : '—'
  // The stop sits before the clock, so clocks stay in one column whether or not a row carries one.
  const isStoppable = canStop(p)
  return {
    node: (
      <Box>
        {word ? <Text color={wordColor}>{`${shorten(word, 12)}  `}</Text> : null}
        {isStoppable ? control(els, C, `${PROC_PREFIX}${p.id}${STOP_SUFFIX}`, STOP, true, d.onStop(p.id)) : null}
        {isStoppable ? <Text> </Text> : null}
        {d.clock(`proc-clock-${p.id}`, p.startedAt, p.endedAt, isLive(p) ? C.accent : C.dim)}
      </Box>
    ),
    width: (word ? cells(shorten(word, 12)) + 2 : 0) + (isStoppable ? cells(STOP) + 1 : 0) + cells(time) + 1,
  }
}

/** A workflow's agent, named by its task: what it does now while it runs, why it ended once it has. */
const kidRow = (els: Els, C: Palette, W: number, k: Proc, isLast: boolean, d: Shared) => {
  const { Button, Text } = els
  const s = status(els, C, k, d)
  const what = isLive(k) ? lastCall(d.calls.get(k.id)?.calls ?? []) : ''
  return line(
    els,
    <Button key={`${PROC_PREFIX}${k.id}`} plain onPress={d.onOpen(k.id)}>
      <Text color={C.dim}>{isLast ? '  └ ' : '  ├ '}</Text>
      <Text color={isLive(k) ? C.body : C.muted}>{fit(shorten(k.task || k.type, KID_W - 1), KID_W)}</Text>
      <Text color={C.muted}>{shorten(what, W - 4 - KID_W - s.width - 1)}</Text>
    </Button>,
    s.node,
  )
}

/** A top-level process: its bar spans every line it takes, and any line of it opens it. */
const item = (els: Els, C: Palette, W: number, p: Proc, d: Shared) => {
  const { Box, Button, Text } = els
  const live = isLive(p)
  const isLoud = live || p.state === 'Z'
  const key = `${PROC_PREFIX}${p.id}`
  const open = d.onOpen(p.id)
  const s = status(els, C, p, d)
  const IW = W - 1
  const lines: RenderNode[] = [
    line(
      els,
      <Button key={key} plain onPress={open}>
        <Text color={isLoud ? C.hi : C.muted} bold={isLoud}>
          {fit(KIND[p.kind], TYPE_W)}
        </Text>
        <Text color={isLoud ? C.body : C.muted}>{glitchText(shorten(rowText(p), IW - TYPE_W - s.width - 1), p.id, p.changedAt, d.now)}</Text>
      </Button>,
      s.node,
    ),
  ]
  if (live && p.kind === 'agent') {
    const t = d.calls.get(p.id)
    const second = secondLine(p, t)
    if (second) {
      const stats = `${plural(totalOf(t), 'tool')} · ${kTokens(p.tokOut)}`
      lines.push(
        line(
          els,
          <Button key={`${key}~last`} plain onPress={open}>
            <Text color={C.muted}>{`${' '.repeat(TYPE_W)}↳ ${shorten(second, IW - TYPE_W - 2 - cells(stats) - 1)}`}</Text>
          </Button>,
          <Text color={C.dim}>{stats}</Text>,
        ),
      )
    }
  }
  if (live && p.kind === 'workflow') {
    const k = shownKids(d.list, p.id)
    k.shown.forEach((kid, i) => lines.push(kidRow(els, C, IW, kid, i === k.shown.length - 1 && k.hidden === 0, d)))
    if (k.hidden > 0)
      lines.push(
        <Button key={`${key}~more`} plain onPress={open}>
          <Text color={C.muted}>{`  └ +${k.hidden} more`}</Text>
        </Button>,
      )
  }
  return (
    <Box key={`row-${p.id}`} hover={{ backgroundColor: C.hover }}>
      {d.bar(`bar-${p.id}`, toneOf(p), lines.length)}
      <Box flexDirection="column" flexGrow={1}>
        {lines}
      </Box>
    </Box>
  )
}

const header = (els: Els, C: Palette, top: readonly Proc[]) => {
  const { Text } = els
  const live = top.filter(isLive).length
  const total = ` · ${top.length}`
  return {
    title: 'processes',
    right: (
      <Text>
        <Text color={live > 0 ? C.accent : C.muted}>{`${live} live`}</Text>
        <Text color={C.muted}>{total}</Text>
      </Text>
    ),
    rightW: cells(`${live} live${total}`),
  }
}

/** `+N more`, a button onto the full list. */
const moreLine = (els: Els, C: Palette, hidden: readonly Proc[], onAll: () => void) => {
  const { Button, Text } = els
  const live = hidden.filter(isLive).length
  const failed = hidden.filter(p => p.state === 'Z').length
  return (
    <Button key="procs-all" plain onPress={onAll}>
      <Text color={C.muted}>{` +${hidden.length} more`}</Text>
      {live > 0 ? <Text color={C.accent}>{` · ${live} live`}</Text> : null}
      {failed > 0 ? <Text color={C.err}>{` · ${failed} failed`}</Text> : null}
    </Button>
  )
}

/** The top-level processes the layout has room for, live ones with their detail lines. */
export const itemsSection = (els: Els, C: Palette, W: number, d: Shared & { items: number }): RenderNode => {
  const top = topLevel(d.list)
  const shown = top.slice(0, d.items)
  const rows = shown.map(p => item(els, C, W, p, d))
  if (shown.length < top.length) rows.push(moreLine(els, C, top.slice(shown.length), d.onAll))
  return section(els, C, { key: 'procs', W, isSpaced: true, fold: d.fold, ...header(els, C, top), rows })
}

/** The furthest the full list pages: its last page full. */
export const maxProcOffset = (list: readonly Proc[], rows: number) => Math.max(0, topLevel(list).length - rows)

/** Every top-level process, one line each, paged, with the way back to the short list. */
export const listSection = (
  els: Els,
  C: Palette,
  W: number,
  d: Shared & { rows: number; offset: number; onPage: (delta: number) => () => void },
): RenderNode => {
  const { Box, Button, Text } = els
  const top = topLevel(d.list)
  const offset = Math.max(0, Math.min(d.offset, top.length - d.rows))
  const shown = top.slice(offset, offset + d.rows)
  const rows = shown.map(p => {
    const s = status(els, C, p, d)
    const isLoud = isLive(p) || p.state === 'Z'
    return (
      <Box key={`row-${p.id}`} hover={{ backgroundColor: C.hover }}>
        {d.bar(`bar-${p.id}`, toneOf(p))}
        <Box flexGrow={1}>
          {line(
            els,
            <Button key={`${PROC_PREFIX}${p.id}`} plain onPress={d.onOpen(p.id)}>
              <Text color={isLoud ? C.hi : C.muted} bold={isLoud}>
                {fit(KIND[p.kind], TYPE_W)}
              </Text>
              <Text color={isLoud ? C.body : C.muted}>{shorten(rowText(p), W - 1 - TYPE_W - s.width - 1)}</Text>
            </Button>,
            s.node,
          )}
        </Box>
      </Box>
    )
  })
  const canUp = offset > 0
  const canDown = offset + d.rows < top.length
  const paging = canUp || canDown
  rows.push(
    <Box columnGap={2}>
      {control(els, C, 'procs-all', ' ‹ fewer', true, d.onAll)}
      {paging ? control(els, C, 'procs-up', '▴', canUp, d.onPage(-d.rows)) : null}
      {paging ? control(els, C, 'procs-down', '▾', canDown, d.onPage(d.rows)) : null}
      {paging ? <Text color={C.dim}>{`${offset + 1}-${offset + shown.length} of ${top.length}`}</Text> : null}
    </Box>,
  )
  return section(els, C, { key: 'procs', W, isSpaced: true, fold: d.fold, ...header(els, C, top), rows })
}

/** One process opened: its task and numbers, its calls (or a workflow's agents), its last words. */
export const detailSection = (
  els: Els,
  C: Palette,
  W: number,
  d: Shared & { proc: Proc; own: Timeline | undefined; rows: number; onBack: () => void },
): RenderNode => {
  const { Box, Button, Text } = els
  const p = d.proc
  const own = d.own?.calls ?? []
  const kids = childrenOf(d.list, p.id)

  const running = isLive(p) ? own.filter(r => r.state === 'run') : []
  const calls = [
    ...[...running].reverse().map(r => runningRow(els, C, W, r, d)),
    ...own
      .filter(r => !running.includes(r))
      .reverse()
      .map(r => pastRow(els, C, W, r)),
  ].slice(0, d.rows)

  // A workflow's agents, newest work first; when they outnumber the rows, the last one says how many more.
  const kidRows = (): RenderNode[] => {
    const fits = kids.length <= d.rows ? kids : kids.slice(0, Math.max(0, d.rows - 1))
    const rows = fits.map((k, i) => (
      <Box key={`row-${k.id}`}>
        {d.bar(`bar-${k.id}`, toneOf(k))}
        <Box flexGrow={1}>{kidRow(els, C, W - 1, k, i === kids.length - 1, d)}</Box>
      </Box>
    ))
    if (fits.length < kids.length) rows.push(<Text color={C.muted}>{`    +${kids.length - fits.length} more`}</Text>)
    return rows
  }
  const body = p.kind === 'workflow' ? kidRows() : calls

  const total = totalOf(d.own)
  const stats =
    p.kind === 'agent' || p.kind === 'wfagent'
      ? `${kTokens(p.ctx)} ctx · ${kTokens(p.tokOut)} out · ${plural(p.steps, 'step')} · ${plural(total, 'tool')}${calls.length > 0 && calls.length < total ? `, last ${calls.length}` : ''}`
      : p.kind === 'workflow'
        ? `${plural(kids.length, 'agent')} · ${kids.filter(isLive).length} live`
        : `${p.type} · started ${fmtWall(p.startedAt)}${p.why ? ` · ${p.why}` : ''}`

  const word = p.state === 'R' ? 'live' : p.state === 'S' ? 'waiting' : p.state === 'X' ? 'done' : p.why || 'failed'
  const wordColor = isLive(p) ? C.accent : p.state === 'Z' ? C.err : C.muted
  const time = p.startedAt > 0 ? fmtClock((p.endedAt ?? d.now) - p.startedAt) : '—'
  const name = `‹ ${shorten(p.type.toLowerCase(), 24)}`
  const words = wrapLines(p.lastText, W - 3, 2)
  return section(els, C, {
    key: 'procs',
    W,
    isSpaced: true,
    fold: d.fold,
    name: (
      <Button key={BACK_KEY} plain onPress={d.onBack}>
        <Text color={C.hi} bold>
          {name}
        </Text>
      </Button>
    ),
    nameW: cells(name),
    right: (
      <Box>
        <Text color={wordColor}>{shorten(word, 12)}</Text>
        <Text color={C.muted}>{' · '}</Text>
        {canStop(p) ? control(els, C, `${PROC_PREFIX}${p.id}${STOP_SUFFIX}`, STOP, true, d.onStop(p.id)) : null}
        {canStop(p) ? <Text> </Text> : null}
        {d.clock(`detail-clock-${p.id}`, p.startedAt, p.endedAt, C.muted)}
      </Box>
    ),
    rightW: cells(shorten(word, 12)) + 3 + (canStop(p) ? cells(STOP) + 1 : 0) + cells(time),
    rows: [
      <Text color={C.hi} bold wrap="truncate">
        {` ${p.task || p.type}`}
      </Text>,
      <Text color={p.state === 'Z' ? C.err : C.muted} wrap="truncate">
        {` ${stats}`}
      </Text>,
      ...(body.length > 0 ? [blank(els), ...body] : []),
      blank(els),
      <Text wrap="truncate">
        {words[0] ? <Text color={C.dim}>{' » '}</Text> : ' '}
        {words[0] ? (
          <Text color={C.muted} italic>
            {words[0]}
          </Text>
        ) : null}
      </Text>,
      <Text color={C.muted} italic wrap="truncate">
        {words[1] ? `   ${words[1]}` : ' '}
      </Text>,
    ],
  })
}
