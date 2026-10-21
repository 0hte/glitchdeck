import type { ElementTable, RenderNode, UiPressArgument } from 'claude-code'

import { mix } from '../core/color'
import { cells } from '../core/text'
import type { Palette } from '../palette'

/** The elements every surface draws; views take only these so one tree serves all four. */
export type Els = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

/** A live clock from `since`, frozen at `endAt`; drawn by register.tsx, which owns the Client module. */
export type Clock = (key: string, since: number, endAt: number | null, color: string) => RenderNode

/** What the bar left of a row says: breathing for running work, still for waiting or failed, blank otherwise. */
export type Tone = 'live' | 'wait' | 'err' | 'none'

/** The bar, `rows` tall, so one breath spans every line of an item. */
export type Bar = (key: string, tone: Tone, rows?: number) => RenderNode

const HATCH = '╱'

/** The hatch after a section's name: from a dimmed accent into the rule color over its first quarter. */
const hatch = (els: Els, C: Palette, n: number) => {
  const { Text } = els
  const runs: { color: string; count: number }[] = []
  for (let i = 0; i < n; i++) {
    const color = mix(C.accent, C.faint, 0.45 + (i / Math.max(1, n - 1)) * 2.2)
    const last = runs[runs.length - 1]
    if (last && last.color === color) last.count += 1
    else runs.push({ color, count: 1 })
  }
  return runs.map(r => <Text color={r.color}>{HATCH.repeat(r.count)}</Text>)
}

export type Fold = { isCollapsed: boolean; onToggle: () => void }

export const FOLD_PREFIX = 'fold-'

/** Bracketed, so it reads as a button among the row's words and clocks. */
export const STOP = '[stop]'

export type Section = {
  key: string
  W: number
  right?: RenderNode
  rightW?: number
  /** A blank row above, between sections. */
  isSpaced?: boolean
  rows: RenderNode[]
  /** Folded, the section is its header alone; its status stays on the right. */
  fold: Fold
} & (
  /** A plain name, which folds the section along with the marker before it. */
  | { title: string }
  /** A name that is a control of its own: only the marker folds. */
  | { name: RenderNode; nameW: number }
)

/** A borderless section: `▾ name ╱╱╱╱ status`, then a blank row and its rows when it has any and is open. */
export const section = (els: Els, C: Palette, s: Section) => {
  const { Box, Button, Text } = els
  const scope = `${FOLD_PREFIX}${s.key}`
  const marker = s.fold.isCollapsed ? '▸ ' : '▾ '
  const title = 'title' in s ? (
    <Text color={C.hi} bold hover={{ scope, color: C.accent }}>
      {s.title}
    </Text>
  ) : null
  const toggle = (
    <Button key={scope} plain onPress={s.fold.onToggle}>
      <Text color={C.dim} hover={{ scope, color: C.accent }}>
        {marker}
      </Text>
      {title}
    </Button>
  )
  const nameW = cells(marker) + ('title' in s ? cells(s.title) : s.nameW)
  const rows = s.fold.isCollapsed ? [] : s.rows
  // A clock that gains a digit between redraws cuts the hatch, never the status: the left side shrinks.
  const hatchW = Math.max(0, s.W - nameW - 1 - (s.right === undefined ? 0 : (s.rightW ?? 0) + 1))
  return (
    <Box key={s.key} flexDirection="column" width={s.W} marginTop={s.isSpaced ? 1 : 0}>
      <Box justifyContent="space-between" width={s.W}>
        <Box flexShrink={1} overflow="hidden">
          {toggle}
          {'name' in s ? s.name : null}
          <Text wrap="truncate"> {hatch(els, C, hatchW)}</Text>
        </Box>
        {s.right === undefined ? null : (
          <Box flexShrink={0} marginLeft={1}>
            {s.right}
          </Box>
        )}
      </Box>
      {rows.length > 0 ? <Text> </Text> : null}
      {rows}
    </Box>
  )
}

/** A row whose left side truncates and whose right side keeps its width. */
export const line = (els: Els, left: RenderNode, right?: RenderNode) => {
  const { Box } = els
  return (
    <Box justifyContent="space-between">
      <Box flexShrink={1} overflow="hidden">
        {left}
      </Box>
      {right === undefined ? null : (
        <Box flexShrink={0} marginLeft={1}>
          {right}
        </Box>
      )}
    </Box>
  )
}

export const blank = (els: Els) => <els.Text> </els.Text>

/** A small control: dim while it can act, fainter while it cannot, so it never outshines the data. */
export const control = (els: Els, C: Palette, key: string, glyph: string, isEnabled: boolean, onPress: (e: UiPressArgument) => void) => {
  const { Button, Text } = els
  return (
    <Button key={key} plain onPress={onPress}>
      <Text color={isEnabled ? C.dim : C.faint}>{glyph}</Text>
    </Button>
  )
}
