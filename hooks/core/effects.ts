import type { Proc, Todos } from '../../types'
import { EDIT_TOOLS, READ_TOOLS, fileOf, todosFromWrite } from './main'
import { newProc } from './procs'

export type Effect =
  | { kind: 'file'; key: string; path: string; isEdit: boolean }
  | { kind: 'proc'; proc: Proc }
  | { kind: 'stop'; id: string }
  | { kind: 'todos'; todos: Todos }
  | { kind: 'todo-created'; id: string; subject: string }
  | { kind: 'todo-updated'; taskId: string; status: string; subject: string; activeForm: string }

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const basename = (p: string) => p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? ''

/**
 * What a call that went through means for the pane, read from its input and result: a file read or
 * edited, a background process started or stopped, the todo list changed. Files and todos count for
 * the main loop only; an agent's own calls are in its timeline.
 */
export const effectsOf = (c: { tool: string; input: unknown; result: unknown; agentId?: string; now: number }): Effect[] => {
  const { tool, now } = c
  const input = obj(c.input)
  const result = obj(c.result)
  const isMain = c.agentId === undefined
  const parent = c.agentId ?? ''
  const out: Effect[] = []

  const file = str(input.file_path) || str(input.notebook_path)
  if (isMain && file && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool))) out.push({ kind: 'file', ...fileOf(file), isEdit: EDIT_TOOLS.has(tool) })

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
    if (id) out.push({ kind: 'stop', id })
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
