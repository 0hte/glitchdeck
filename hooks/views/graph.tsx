import type { RenderNode } from 'claude-code'

import type { FlowCols } from '../../types'
import { rgb } from '../core/color'
import { flowRates } from '../core/flow'
import { areaCells, brailleRows, encodeCells } from '../core/graph'
import { GRAPH_ROWS } from '../core/layout'
import type { Palette } from '../palette'
import { graphColor } from '../palette'
import type { Els } from './section'

export const GRAPH_KEY = 'graph'

/** The narrowest body the graph draws in. */
export const GRAPH_MIN_W = 16

/** Columns the graph takes in a body `W` wide: a space each side, and the number beside it. */
export const graphCols = (W: number) => W - 8

const LABEL_W = 7
const DEFAULT = 0x01000000

/** What the graph draws: the flow's closed columns, and whether anything still runs. */
export type GraphData = { flow: FlowCols; isLive: boolean }

const ratesOf = (g: GraphData, cols: number) => flowRates(g.flow, cols)

const label = (C: Palette, g: GraphData, tps: string): [string, string][] => [
  [` ${tps.padStart(5)} `, g.isLive ? C.hi : C.muted],
  [' tok/s ', C.muted],
  ['   60s ', C.dim],
]

/** The Raster's cells: the area, then the speed of the newest column beside it, so one blit moves both. */
export const graphCells = (C: Palette, g: GraphData, cols: number) => {
  const rates = ratesOf(g, cols)
  const area = areaCells(rates, GRAPH_ROWS, graphColor(g.isLive))
  const lines = label(C, g, String(Math.round(rates.at(-1) ?? 0)))
  const width = cols + LABEL_W
  const out = new Uint32Array(width * GRAPH_ROWS * 3)
  for (let r = 0; r < GRAPH_ROWS; r++) {
    out.set(area.subarray(r * cols * 3, (r + 1) * cols * 3), r * width * 3)
    const [text, color] = lines[r] ?? ['', C.dim]
    const glyphs = [...text.padEnd(LABEL_W)].slice(0, LABEL_W)
    glyphs.forEach((ch, i) => out.set([ch.codePointAt(0) ?? 0x20, rgb(color), DEFAULT], (r * width + cols + i) * 3))
  }
  return encodeCells(out)
}

/** Output speed as a scope: eighths of a cell where the surface has a Raster, braille elsewhere. */
export const graphView = (
  els: Els,
  C: Palette,
  W: number,
  d: { g: GraphData; raster: ((cols: number, cells: string) => RenderNode) | undefined },
): RenderNode => {
  const { Box, Text } = els
  const cols = graphCols(W)
  if (d.raster)
    return (
      <Box width={W}>
        <Text> </Text>
        {d.raster(cols + LABEL_W, graphCells(C, d.g, cols))}
      </Box>
    )
  const rates = ratesOf(d.g, cols)
  return (
    <Box width={W}>
      <Text> </Text>
      <Box flexDirection="column">
        {brailleRows(
          rates.flatMap(v => [v, v]),
          GRAPH_ROWS,
        ).map(row => (
          <Text color={d.g.isLive ? C.accent : C.dim}>{row}</Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {label(C, d.g, String(Math.round(rates.at(-1) ?? 0))).map(([text, color]) => (
          <Text color={color}>{text}</Text>
        ))}
      </Box>
    </Box>
  )
}
