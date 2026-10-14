// Credential patterns, the first few adapted from scasella/claude-flightdeck (MIT).
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, '•••PRIVATE KEY•••'],
  [/((?:proxy-)?authorization["']?\s*[:=]\s*["']?)[^"'\r\n]+/gi, '$1•••'],
  [/((?:set-)?cookie["']?\s*:\s*["']?)[^"'\r\n]+/gi, '$1•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|ghr|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [
    /\b(?:glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|(?:shpat|shpss|shpca|shppa)_[A-Fa-f0-9]{32}|do[opr]_v1_[a-f0-9]{64}|xapp-[A-Za-z0-9-]{20,}|ya29\.[0-9A-Za-z_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}\b|AIza[0-9A-Za-z_-]{30,})/g,
    '•••',
  ],
  [/\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,2048}/g, '•••'],
  [
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token|secret|password|passwd|passphrase|pwd)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&}"']+)/gi,
    '$1•••',
  ],
  [/(--(?:token|password|passwd|pass|api-?key|apikey|auth-token|access-token|secret|client-secret)[= ])\S+/gi, '$1•••'],
  [/(\bmysql(?:dump|admin)?\b[^|;&\n]*?\s-p)(?!\s)\S+/gi, '$1•••'],
  [/(\bsshpass\s+-p\s*)\S+/gi, '$1•••'],
  [/((?:^|\s)(?:-u|--user)\s*[^\s:]+:)[^\s@]+/g, '$1•••'],
  [/(\b(?:[A-Za-z0-9]+[_-])*(?:API_?KEY|KEY|TOKEN|SECRET|PASS(?:WORD|WD)?|PWD|CREDENTIALS?|AUTH)=)[^\s"'&;]+/gi, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
  [/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|sig|signature|access_token|api_key|apikey|key|token|code|password)=)[^&\s#"']+/gi, '$1•••'],
  [/((?:AccountKey|SharedAccessKey|SharedAccessSignature)=)[^;\s"']+/gi, '$1•••'],
]

// Nothing glitchdeck keeps is longer than a few hundred characters, and the patterns stay linear on this much.
const REDACT_CAP = 8192

/** Masks credentials before anything is drawn or kept, so the pane never shows one on a screen share. */
export const redact = (s: string) => {
  let t = s.length > REDACT_CAP ? s.slice(0, REDACT_CAP) : s
  if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1)
  return SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), t)
}

// Escape sequences, then the control and direction-override characters left: the engine refuses a
// tree holding a control character, and an override could reorder a drawn command.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g

export const clean = (s: string) => s.replace(ANSI, '').replace(CONTROL, '')

/** One drawable line: no control characters, every run of whitespace one space. */
export const oneLine = (s: string) => clean(s).replace(/\s+/g, ' ').trim()

/** FNV-1a, for a stable id of a string that is not itself kept. */
export const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619)
  return h >>> 0
}

// East Asian wide and fullwidth ranges, and the emoji blocks terminals draw two cells wide.
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f5],
  [0x26fa, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x2753, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

const isZeroWidth = (cp: number) =>
  (cp >= 0x0300 && cp <= 0x036f) || cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)

/** Cells one code point takes in a terminal: 0 for joiners and marks, 2 for wide and emoji, else 1. */
export const cellWidth = (cp: number) => {
  if (isZeroWidth(cp)) return 0
  for (const [lo, hi] of WIDE) {
    if (cp < lo) return 1
    if (cp <= hi) return 2
  }
  return 1
}

/** Width in terminal cells. */
export const cells = (s: string) => {
  let w = 0
  for (const ch of s) w += cellWidth(ch.codePointAt(0) ?? 0)
  return w
}

/** The longest head of `s` that fits in `n` cells. */
const head = (s: string, n: number) => {
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = cellWidth(ch.codePointAt(0) ?? 0)
    if (w + cw > n) break
    out += ch
    w += cw
  }
  return out
}

/** Cut to `n` cells with an ellipsis, never splitting a wide glyph. */
export const shorten = (s: string, n: number) => {
  if (n <= 0) return ''
  const one = oneLine(s)
  if (cells(one) <= n) return one
  return `${head(one, n - 1).trimEnd()}…`
}

/** Exactly `n` cells: cut with an ellipsis or padded with spaces. */
export const fit = (s: string, n: number) => {
  const cut = shorten(s, n)
  return cut + ' '.repeat(Math.max(0, n - cells(cut)))
}

/** Up to `max` lines of `n` cells, broken at spaces, the last one cut with an ellipsis. */
export const wrapLines = (s: string, n: number, max: number): string[] => {
  let rest = oneLine(s)
  if (n <= 0 || max <= 0 || rest === '') return []
  const lines: string[] = []
  while (lines.length < max - 1 && cells(rest) > n) {
    const h = head(rest, n)
    const space = h.lastIndexOf(' ')
    const cut = space > 0 ? h.slice(0, space) : h
    if (cut === '') break
    lines.push(cut)
    rest = rest.slice(cut.length).trimStart()
  }
  if (rest !== '') lines.push(shorten(rest, n))
  return lines
}
