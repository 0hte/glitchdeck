import { mix } from './core/color'

/** Neutrals for everything finished, one ice accent for what is alive, red for what failed. */
export const C = {
  hi: '#ECEAF4',
  body: '#C6C3D3',
  muted: '#9C99AD',
  dim: '#7C798E',
  faint: '#34333F',
  accent: '#5CE1FF',
  err: '#FF5C7A',
  // The terminal's own background cannot be read: this sits just above the usual dark ones.
  hover: '#2E2D3A',
}

export type Palette = typeof C

const BREATH_STEPS = 16
export const BREATH_MS = 150

/** One breath of the live bar, full accent down toward the rule color and back. */
export const BREATH = Array.from({ length: BREATH_STEPS }, (_, i) => mix(C.accent, C.faint, 0.3 * (1 - Math.cos((i / BREATH_STEPS) * 2 * Math.PI))))

/**
 * A graph pixel: brightest on the top edge and at the newest column, never past the rule color, so the
 * oldest pixels never read as a dark patch on a lighter background. Gray once nothing runs.
 */
export const graphColor = (isLive: boolean) => (fromTop: number, age: number) =>
  mix(isLive ? C.accent : C.dim, C.faint, Math.min(0.85, 0.08 + fromTop * 0.6 + 0.45 * age ** 1.5))
