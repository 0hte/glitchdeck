import type { FileMarks } from '../../types'
import { hash, oneLine } from './text'

export const READ = 1
export const EDITED = 2
export const CREATED = 4
export const DELETED = 8

// Distinct files are counted by remembering each; past this many, new ones are no longer counted.
export const FILES_CAP = 5000

export const READ_TOOLS = new Set(['Read'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** Where the files a session's tools act on are found: its working directory, and Claude's own folders. */
export type Place = { cwd: string; home: string; roots: readonly string[] }

const isAbsolute = (p: string) => p.startsWith('/') || /^[a-zA-Z]:\//.test(p)

/** A path made absolute and plain: forward slashes, no `.` or `..`, and one case on Windows, whose paths ignore it. */
export const normalPath = (raw: string, place: Pick<Place, 'cwd' | 'home'>) => {
  let p = oneLine(raw).replace(/\\/g, '/')
  if (p === '~' || p.startsWith('~/')) p = place.home.replace(/\\/g, '/') + p.slice(1)
  if (!isAbsolute(p)) p = `${place.cwd.replace(/\\/g, '/')}/${p}`
  const parts: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') parts.pop()
    else if (s !== '.' && (s !== '' || parts.length === 0)) parts.push(s)
  }
  const out = parts.join('/')
  return /^[a-zA-Z]:\//.test(out) ? out.toLowerCase() : out
}

/** Claude's own folders: its config directory, and the temporary one that holds scratchpads and task output. */
export const internalRoots = (env: Record<string, string | undefined>) => {
  const home = env.HOME || env.USERPROFILE || ''
  const temp = env.TMPDIR || env.TEMP || env.TMP || ''
  const place = { cwd: '/', home }
  return [env.CLAUDE_CONFIG_DIR || (home && `${home}/.claude`), temp && `${temp}/claude`, '/tmp/claude']
    .filter((r): r is string => !!r)
    .map(r => normalPath(r, place))
}

export const isInternal = (normal: string, roots: readonly string[]) => roots.some(r => normal === r || normal.startsWith(`${r}/`))

/** A file's key: a hash of its whole path, so each is counted once and no path is kept. */
export const keyOf = (normal: string) => hash(normal).toString(36)

export const markFile = (marks: FileMarks, key: string, mark: number): FileMarks => {
  const had = marks[key] ?? 0
  if ((had & mark) === mark || (had === 0 && Object.keys(marks).length >= FILES_CAP)) return marks
  return { ...marks, [key]: had | mark }
}

/** A file the session created is counted as created, not edited, whatever was done to it after. */
export const countFiles = (marks: FileMarks) => {
  const c = { read: 0, edited: 0, created: 0, deleted: 0 }
  for (const m of Object.values(marks)) {
    if (m & READ) c.read++
    if (m & CREATED) c.created++
    else if (m & EDITED) c.edited++
    if (m & DELETED) c.deleted++
  }
  return c
}

const BASH_DELETE = new Set(['rm', 'unlink'])
const PWSH_DELETE = new Set(['remove-item', 'rm', 'del', 'erase', 'ri'])
// PowerShell parameters whose value is a pattern, not a path.
const PWSH_VALUED = /^-(filter|include|exclude)$/i

const words = (segment: string) => [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')

/**
 * The paths a shell command names for deletion, read from its words: no tool reports a deletion.
 * A glob or a folder counts as one path; a `git rm --cached` deletes nothing on disk.
 */
export const deletedPaths = (command: string, isPowerShell: boolean): string[] => {
  const out: string[] = []
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    let w = words(segment.trim())
    while (w[0] !== undefined && (w[0] === 'sudo' || /^\w+=/.test(w[0]))) w = w.slice(1)
    const head = (w[0] ?? '').toLowerCase()
    const isGitRm = head === 'git' && w[1] === 'rm'
    if (isGitRm ? w.includes('--cached') : !(isPowerShell ? PWSH_DELETE : BASH_DELETE).has(head)) continue
    const args = w.slice(isGitRm ? 2 : 1)
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (isPowerShell && PWSH_VALUED.test(a)) i++
      else if (a !== '' && !a.startsWith('-') && !/[<>&]/.test(a)) out.push(a)
    }
  }
  return out
}
