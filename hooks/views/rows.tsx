import type { RenderNode } from 'claude-code'

import type { ToolRow, ToolState } from '../../types'
import { fmtClock, fmtMs } from '../core/fmt'
import { cells, shorten } from '../core/text'
import type { Palette } from '../palette'
import type { Bar, Clock, Els } from './section'
import { line } from './section'

const GLYPH: Record<ToolState, string> = { run: '·', ok: '✓', err: '✗', deny: '⊘' }

/** A tool's name padded to a column; a longer one keeps its whole name. */
const toolName = (tool: string) => (cells(tool) >= 6 ? `${tool} ` : `${tool}${' '.repeat(6 - cells(tool))}`)

/** A call still running: the breathing bar, its name and target bright, its clock in the accent; a held one's bar is still. */
export const runningRow = (
  els: Els,
  C: Palette,
  W: number,
  r: ToolRow,
  d: { clock: Clock; bar: Bar; now: number; wait?: string },
): RenderNode => {
  const { Box, Text } = els
  const name = toolName(r.tool)
  const word = d.wait ? shorten(d.wait, 12) : ''
  const clock = d.clock(`tool-${r.id}`, r.startedAt, null, C.accent)
  const rightW = (word ? cells(word) + 2 : 0) + cells(r.startedAt > 0 ? fmtClock(d.now - r.startedAt) : '—')
  return line(
    els,
    <Box>
      {d.bar(`bar-${r.id}`, word ? 'wait' : 'live')}
      <Text color={C.hi} bold>
        {name}
      </Text>
      <Text color={C.hi}>{shorten(r.target, W - 1 - cells(name) - rightW - 1)}</Text>
    </Box>,
    word ? (
      <Box>
        <Text color={C.accent}>{`${word}  `}</Text>
        {clock}
      </Box>
    ) : (
      clock
    ),
  )
}

/** A finished call, gray when it went through; a failed one keeps its target readable. */
export const pastRow = (els: Els, C: Palette, W: number, r: ToolRow): RenderNode => {
  const { Text } = els
  const isBad = r.state === 'err' || r.state === 'deny'
  const name = toolName(r.tool)
  const ms = r.ms === null ? '' : fmtMs(r.ms)
  return line(
    els,
    <Text>
      <Text color={isBad ? C.err : C.dim}>{`  ${GLYPH[r.state]} `}</Text>
      <Text color={C.muted}>{name}</Text>
      <Text color={isBad ? C.body : C.muted}>{shorten(r.target, W - 4 - cells(name) - cells(ms) - 1)}</Text>
    </Text>,
    ms ? <Text color={C.dim}>{ms}</Text> : undefined,
  )
}
