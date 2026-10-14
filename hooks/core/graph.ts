import { rgb } from './color'

/** A Raster cell's color that leaves the terminal's own. */
const DEFAULT = 0x01000000
/** `▁` is one eighth of a cell; `█` the whole of it. */
const LOWER_EIGHTH = 0x2581
const FULL = 0x2588

/** The span of time the graph shows, right edge now: its columns share it, one per tick. */
export const WINDOW_MS = 60_000

/** How long one column stands for, and so how often the graph scrolls by exactly one. */
export const columnMs = (cols: number) => Math.round(WINDOW_MS / Math.max(1, cols))

/**
 * Columns as a filled area in eighths of a cell, scaled to the largest: any value above zero shows at
 * least one eighth, an empty column stays the terminal's own. `color(fromTop, age)` paints a cell:
 * `fromTop` 0 at the top row, `age` 0 at the newest column.
 */
export const areaCells = (values: readonly (number | null)[], rows: number, color: (fromTop: number, age: number) => string) => {
  const cols = values.length
  const out = new Uint32Array(cols * rows * 3)
  const max = Math.max(1e-9, ...values.map(v => v ?? 0))
  const eighths = rows * 8
  for (let c = 0; c < cols; c++) {
    const v = values[c] ?? 0
    const h = v > 0 ? Math.max(1, Math.round((v / max) * eighths)) : 0
    const age = 1 - c / Math.max(1, cols - 1)
    for (let r = 0; r < rows; r++) {
      const fill = Math.max(0, Math.min(8, h - (rows - 1 - r) * 8))
      const i = (r * cols + c) * 3
      if (fill === 0) out.set([0x20, DEFAULT, DEFAULT], i)
      else out.set([fill === 8 ? FULL : LOWER_EIGHTH + fill - 1, rgb(color(r / Math.max(1, rows - 1), age)), DEFAULT], i)
    }
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A Raster's `cells`: padded base64 of little-endian u32 triplets. */
export const encodeCells = (cells: Uint32Array) => {
  const bytes = new Uint8Array(cells.length * 4)
  const view = new DataView(bytes.buffer)
  cells.forEach((v, i) => view.setUint32(i * 4, v, true))
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    s += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    s += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return s
}

// Braille dots filled bottom-up, left column then right: levels 0-4 per column.
const LEFT = [0, 0x40, 0x44, 0x46, 0x47]
const RIGHT = [0, 0x80, 0xa0, 0xb0, 0xb8]

/** The same area in braille, two values per cell, top row first: for surfaces without a Raster. */
export const brailleRows = (values: readonly (number | null)[], rows: number) => {
  const cols = Math.floor(values.length / 2)
  const max = Math.max(1e-9, ...values.map(v => v ?? 0))
  const level = (i: number) => {
    const v = values[i] ?? 0
    return v > 0 ? Math.max(1, Math.round((v / max) * rows * 4)) : 0
  }
  const out: string[] = []
  for (let r = rows - 1; r >= 0; r--) {
    let s = ''
    for (let c = 0; c < cols; c++) {
      const l = Math.max(0, Math.min(4, level(2 * c) - r * 4))
      const rr = Math.max(0, Math.min(4, level(2 * c + 1) - r * 4))
      s += String.fromCharCode(0x2800 + (LEFT[l] ?? 0) + (RIGHT[rr] ?? 0))
    }
    out.push(s)
  }
  return out
}
