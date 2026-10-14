import type { RenderNode } from 'claude-code'

import type { HistoryEntry } from '../../types'
import { fmtWall } from '../core/fmt'
import { cells, shorten } from '../core/text'
import type { Palette } from '../palette'
import type { Els } from './section'
import { control, line, section } from './section'

export const HIST_PREFIX = 'hist-'

/** Newest first, `rows` of them from `offset`; each row one Button the press hook jumps from. */
export const historySection = (
  els: Els,
  C: Palette,
  W: number,
  d: { list: readonly HistoryEntry[]; offset: number; rows: number; onNewer: () => void; onOlder: () => void },
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
              <Text color={p.n === newest ? C.hi : C.body}>{shorten(p.text, W - cells(num) - 2 - cells(at) - 1)}</Text>
            </Button>,
            <Text color={C.dim}>{at}</Text>,
          )}
        </Box>
      )
    })
  const count = String(d.list.length)
  const paging = canNewer || canOlder
  return section(els, C, {
    key: 'history',
    W,
    isSpaced: true,
    name: (
      <Text color={C.hi} bold>
        prompts
      </Text>
    ),
    nameW: 7,
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
