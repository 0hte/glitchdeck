import { cellWidth, hash } from './text'

/** How long a row glitches after it changes state, and how often the effect redraws. */
export const GLITCH_MS = 1500
export const FRAME_MS = 120

const NOISE = ['▓', '▒', '░', '/', '\\', '|', '_', '#']

export const isGlitching = (changedAt: number, now: number) => changedAt > 0 && now - changedAt < GLITCH_MS

/**
 * The text a few cells corrupted, seeded by `seed` and the frame so a test sees the same thing twice;
 * the corruption thins out over the effect and the text comes back whole when it ends. Same width always.
 */
export const glitchText = (text: string, seed: string, changedAt: number, now: number) => {
  if (!isGlitching(changedAt, now)) return text
  const cps = [...text]
  if (cps.length === 0) return text
  const frame = Math.floor((now - changedAt) / FRAME_MS)
  const left = 1 - (now - changedAt) / GLITCH_MS
  const hits = Math.max(1, Math.round(Math.min(3, cps.length / 3) * left))
  const h = hash(`${seed}:${frame}`)
  for (let i = 0; i < hits; i++) {
    const at = (h >>> (i * 5)) % cps.length
    // Only one-cell glyphs are swapped, so the row keeps its width.
    const ch = cps[at] ?? ' '
    if (ch !== ' ' && cellWidth(ch.codePointAt(0) ?? 0) === 1) cps[at] = NOISE[(h >>> (i * 3 + 1)) % NOISE.length] ?? '▒'
  }
  return cps.join('')
}
