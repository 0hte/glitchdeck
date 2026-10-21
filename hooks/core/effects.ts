import type { Proc, ProcState, Todos } from '../../types'
import { CREATED, DELETED, EDITED, EDIT_TOOLS, READ, READ_TOOLS, deletedPaths, isInternal, keyOf, normalPath } from './files'
import type { Place } from './files'
import { todosFromWrite } from './main'
import { newProc } from './procs'

export type Effect =
  | { kind: 'file'; key: string; mark: number }
  | { kind: 'proc'; proc: Proc }
  | { kind: 'end'; id: string; state: ProcState; why: string }
  | { kind: 'todos'; todos: Todos }
  | { kind: 'todo-created'; id: string; subject: string }
  | { kind: 'todo-updated'; taskId: string; status: string; subject: string; activeForm: string }

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const basename = (p: string) => p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? ''

/** Whether a file call made the file: Write says so, and an Edit that had no original file did. */
const isCreation = (tool: string, result: Record<string, unknown>) =>
  (tool === 'Write' && result.type === 'create') || (tool === 'Edit' && result.originalFile === null)

/**
 * What a call that went through means for the pane, read from its input and result: a file read,
 * edited, created or deleted, a background process started or stopped, the todo list changed. Files
 * and todos count for the main loop only, Claude's own files never; an agent's calls are in its timeline.
 */
export const effectsOf = (c: { tool: string; input: unknown; result: unknown; agentId?: string; now: number; place: Place }): Effect[] => {
  const { tool, now, place } = c
  const input = obj(c.input)
  const result = obj(c.result)
  const isMain = c.agentId === undefined
  const parent = c.agentId ?? ''
  const out: Effect[] = []
  const touch = (raw: string, mark: number) => {
    const normal = normalPath(raw, place)
    if (!isInternal(normal, place.roots)) out.push({ kind: 'file', key: keyOf(normal), mark })
  }

  const file = str(input.file_path) || str(input.notebook_path)
  if (isMain && file && READ_TOOLS.has(tool)) touch(file, READ)
  if (isMain && file && EDIT_TOOLS.has(tool)) touch(file, isCreation(tool, result) ? CREATED : EDITED)
  // A command sent to the background has not run yet when its call answers.
  if (isMain && (tool === 'Bash' || tool === 'PowerShell') && !str(result.backgroundTaskId))
    for (const p of deletedPaths(str(input.command), tool === 'PowerShell')) touch(p, DELETED)

  if ((tool === 'Bash' || tool === 'PowerShell') && str(result.backgroundTaskId)) {
    const type = tool === 'Bash' ? 'bash' : 'pwsh'
    const endsWithParent = result.backgroundEndsWithFinalResponse === true
    out.push({ kind: 'proc', proc: newProc({ id: str(result.backgroundTaskId), kind: 'shell', type, task: str(input.command), now, parent, endsWithParent }) })
  }
  if (tool === 'Monitor' && str(result.taskId)) {
    const task = str(input.description) || str(input.command)
    out.push({ kind: 'proc', proc: newProc({ id: str(result.taskId), kind: 'monitor', type: 'monitor', task, now, parent }) })
  }
  if (tool === 'Workflow' && str(result.taskId)) {
    // The tool ignores the call's description and title: a run is named by its script.
    const name = str(result.workflowName) || str(input.name) || basename(str(input.scriptPath)) || 'workflow'
    const id = str(result.runId) || str(result.taskId)
    out.push({ kind: 'proc', proc: newProc({ id, taskId: str(result.taskId), kind: 'workflow', type: 'workflow', task: name, now, parent }) })
  }
  if (tool === 'TaskStop') {
    const id = str(input.task_id) || str(input.shell_id)
    if (id) out.push({ kind: 'end', id, state: 'Z', why: 'killed' })
  }
  // Only the model's own GetTask calls reach a hook: the engine splices its deliveries into the messages.
  if (tool === 'GetTask' && str(input.taskId)) {
    const id = str(input.taskId)
    const status = str(result.status)
    const code = /Exited with code (\d+)/.exec(str(result.statusMessage))?.[1]
    const failed = code !== undefined && code !== '0' ? `exit ${code}` : obj(result.result).isError === true ? 'failed' : ''
    if (status === 'cancelled') out.push({ kind: 'end', id, state: 'Z', why: 'killed' })
    else if (status === 'failed') out.push({ kind: 'end', id, state: 'Z', why: 'failed' })
    else if (status === 'completed') out.push({ kind: 'end', id, state: failed ? 'Z' : 'X', why: failed })
  }

  if (isMain && tool === 'TodoWrite') out.push({ kind: 'todos', todos: todosFromWrite(input.todos) })
  if (isMain && tool === 'TaskCreate') {
    const task = obj(result.task)
    if (str(task.id)) out.push({ kind: 'todo-created', id: str(task.id), subject: str(task.subject) || str(input.subject) })
  }
  if (isMain && tool === 'TaskUpdate' && str(input.taskId))
    out.push({ kind: 'todo-updated', taskId: str(input.taskId), status: str(input.status), subject: str(input.subject), activeForm: str(input.activeForm) })
  return out
}
