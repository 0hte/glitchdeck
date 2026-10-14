// The bar left of live work, cycling its colors on the surface's own clock so the pane need not redraw.
import type { ClientModule } from 'claude-code'

type Props = { colors: string[]; glyph: string; rows: number; ms: number; now: number }
type Ref = { base: number; ticks: number; lastNow: number }
type State = { ref: Ref }

const Breathe: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: -1 }
  // The step counts from the hooks' clock, so bars that appeared at different moments breathe together.
  if (props.now !== ref.lastNow) {
    ref.lastNow = props.now
    ref.base = Math.floor(props.now / Math.max(1, props.ms))
    ref.ticks = 0
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(props.ms, () => {
      ref.ticks += 1
      surface.setState({ ref })
    })
  }
  const color = props.colors[(ref.base + ref.ticks) % Math.max(1, props.colors.length)]
  return (
    <Box flexDirection="column">
      {Array.from({ length: Math.max(1, props.rows) }, () => (
        <Text color={color}>{props.glyph}</Text>
      ))}
    </Box>
  )
}

export default Breathe
