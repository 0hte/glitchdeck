import { shorten } from './text'

/** `0.4s`, `12s`, `3:07`, `1h05`. */
export const fmtMs = (ms: number) => {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** A running clock as the elapsed client draws it: `0:42`, `12:05`, `1h05`. */
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** Wall-clock `HH:MM` of an epoch time, in the environment's zone. */
export const fmtWall = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 5) : '--:--')

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `claude-opus-5-5[1m]` → `Opus 5.5`. */
export const prettyModel = (id: string) => {
  if (!id) return 'Claude'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?!\d)/i.exec(id)
  if (m?.[1] && m[2]) return `${cap(m[1].toLowerCase())} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  return shorten(id, 18)
}
