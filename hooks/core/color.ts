const channels = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `#rrggbb` as `0xrrggbb`. */
export const rgb = (hex: string) => parseInt(hex.slice(1, 7), 16)

/** `a` moved toward `b` by `k`, 0 to 1. */
export const mix = (a: string, b: string, k: number) => {
  const x = channels(a)
  const y = channels(b)
  const t = Math.max(0, Math.min(1, k))
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')}`
}
