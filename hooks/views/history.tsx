import type { RenderNode, UiPressArgument } from 'claude-code'

import type { HistoryEntry } from '../../types'
import { fmtWall } from '../core/fmt'
import { cells, shorten } from '../core/text'
import type { Palette } from '../palette'
import type { Els, Fold } from './section'
import { control, line, section } from './section'

export const HIST_PREFIX = 'hist-'
export const FILL_SUFFIX = '~fill'
export const COPY_SUFFIX = '~copy'
const FILL_GLYPH = '↩'
// Two cells: fonts that lack the glyph draw it wider than one, past the row's edge and its hover.
const COPY_GLYPH = '⧉ '

/** A prompt's number from any of its buttons' keys (`hist-<n>` or `hist-<n>~part`). */
export const histNumOf = (element: string) => Number(element.slice(HIST_PREFIX.length).split('~')[0])

/** Newest first, `rows` of them from `offset`; each row one Button the press hook jumps from. */
export const historySection = (
  els: Els,
  C: Palette,
  W: number,
  d: {
    list: readonly HistoryEntry[]
    offset: number
    rows: number
    onNewer: () => void
    onOlder: () => void
    onFill: (n: number) => () => void
    onCopy: (n: number) => (e: UiPressArgument) => void
    fold: Fold
  },
): RenderNode => {
  const { Box, Button, Text } = els
  const canNewer = d.offset > 0
  const canOlder = d.offset + d.rows < d.list.length
  const newest = d.list[d.list.length - 1]?.n
  const rows = [...d.list]
    .reverse()
    .slice(d.offset, d.offset + d.rows)
    .map(p => {
      const num = String(p.n).padStart(3)
      const at = fmtWall(p.at)
      const tailW = cells(at) + 1 + cells(FILL_GLYPH) + 1 + cells(COPY_GLYPH)
      // One hover group per row, so its number lights with it.
      const scope = `${HIST_PREFIX}${p.n}`
      return (
        <Box key={`row-hist-${p.n}`} hover={{ scope, backgroundColor: C.hover }}>
          {line(
            els,
            <Button key={`${HIST_PREFIX}${p.n}`} plain onPress={() => {}}>
              <Text color={C.dim} hover={{ scope, color: C.accent }}>
                {num}
              </Text>
              <Text>{'  '}</Text>
              <Text color={p.n === newest ? C.hi : C.body}>{shorten(p.text, W - cells(num) - 2 - 1 - tailW)}</Text>
            </Button>,
            <Box columnGap={1}>
              <Text color={C.dim}>{at}</Text>
              {control(els, C, `${HIST_PREFIX}${p.n}${FILL_SUFFIX}`, FILL_GLYPH, true, d.onFill(p.n))}
              {control(els, C, `${HIST_PREFIX}${p.n}${COPY_SUFFIX}`, COPY_GLYPH, true, d.onCopy(p.n))}
            </Box>,
          )}
        </Box>
      )
    })
  const count = String(d.list.length)
  // Folded, there is no page to turn: the count alone stays.
  const paging = !d.fold.isCollapsed && (canNewer || canOlder)
  return section(els, C, {
    key: 'history',
    W,
    isSpaced: true,
    title: 'prompts',
    fold: d.fold,
    right: (
      <Box columnGap={1}>
        <Text color={C.muted}>{count}</Text>
        {paging ? control(els, C, 'page-newer', '▴', canNewer, d.onNewer) : null}
        {paging ? control(els, C, 'page-older', '▾', canOlder, d.onOlder) : null}
      </Box>
    ),
    rightW: cells(count) + (paging ? 4 : 0),
    rows,
  })
}
