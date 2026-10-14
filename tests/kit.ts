// What the test files share: the pane's props, a spawn, and readers over a drawn tree.

export const pane = (bodyColumns: number, bodyRows = 50) => ({
  plugin: 'glitchdeck',
  component: 'Pane' as const,
  requestId: 'glitchdeck',
  props: { title: 'glitchdeck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
})

let spawnN = 0
export const spawn = (subagentType: string, description: string, extra: object = {}) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  ...extra,
})

export const note = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

export const promptRow = (uuid: string, text: string) => ({
  message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text }] },
  door: 'prompt' as const,
  origin: { kind: 'composer' as const },
  uuid,
})

export type Node = { type: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && typeof (n as Node).type === 'string'

/** Every element of a drawn tree, with the elements above it. */
export const walk = (n: unknown, visit: (el: Node, above: readonly Node[]) => void, above: readonly Node[] = []) => {
  if (!isNode(n)) return
  visit(n, above)
  for (const c of n.children ?? []) walk(c, visit, [...above, n])
}

export const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')

/** The colors a subtree paints its text with. */
export const colorsIn = (n: unknown) => {
  const out: string[] = []
  walk(n, el => {
    if (el.type === 'Text' && typeof el.props?.color === 'string') out.push(el.props.color)
  })
  return out
}

/** The first element under `n` whose key is `key`. */
export const byKey = (n: unknown, key: string): Node | undefined => {
  let found: Node | undefined
  walk(n, el => {
    if (!found && el.props?.key === key) found = el
  })
  return found
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

/** Rows a drawn tree takes, as the terminal lays it out: columns add up, rows take their tallest. */
export const heightOf = (n: unknown): number => {
  if (!isNode(n)) return 0
  const p = n.props ?? {}
  const margin = num(p.marginTop)
  if (typeof p.height === 'number') return p.height + margin
  if (n.type === 'Text' || n.type === 'Button') return 1 + margin
  if (n.type === 'Raster') return num(p.rows)
  if (n.type === 'Client') {
    const inner = p.props as { rows?: unknown } | undefined
    return typeof inner?.rows === 'number' ? inner.rows : 1
  }
  const kids = (n.children ?? []).map(heightOf)
  return (p.flexDirection === 'column' ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids)) + margin
}
