export type HistoryEntry = {
  /** Shell-history number, 1-based, never reused within a session. */
  n: number
  /** The prompt row's transcript id (`session.append` uuid); '' when it was read back without one. */
  uuid: string
  text: string
  at: number
}

export type SectionKey = 'main' | 'procs' | 'history'

export type Collapsed = Partial<Record<SectionKey, boolean>>

/**
 * `agent`: the process whose timeline replaces the list, '' for the list. `allProcs`: every process
 * as a paged list instead. `isClosed`: the person closed the pane, so a reload does not reopen it.
 * `collapsed`: the sections folded to their header; optional, so a view stored before it still reads.
 */
export type View = { histOffset: number; agent: string; allProcs: boolean; procOffset: number; isClosed: boolean; collapsed?: Collapsed }

export type ActivityKind = 'idle' | 'requesting' | 'thinking' | 'responding' | 'tool-input' | 'tool-use'

export type Activity = { kind: ActivityKind; tool: string; target: string; since: number }

export type ToolState = 'run' | 'ok' | 'err' | 'deny'

export type ToolRow = {
  id: string
  tool: string
  target: string
  state: ToolState
  /** 0 when the call was read back from a conversation, which keeps no times. */
  startedAt: number
  ms: number | null
}

export type LastTurn = { durationMs: number; tools: number; errors: number; reason: string; endedAt: number }

/** The graph's closed columns, oldest first: output tokens in each, and how long each lasted. */
export type FlowCols = { cols: number[]; ms: number[] }

export type Main = {
  model: string
  isRunning: boolean
  turnStartedAt: number
  activity: Activity
  /** The current turn's main-loop tool calls, oldest first. */
  tools: ToolRow[]
  /** A copy of the graph's columns for a reload, written when it stops or first draws; the live ones stay in the module. */
  flow: FlowCols
  lastTurn: LastTurn | null
  /** The running turn's id, what `$.turn.abort` takes; '' between turns. */
  turnId: string
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type Todo = { id: string; text: string; status: TodoStatus }

/** `active`: what the in-progress task is doing, shown beside the gauge; `activeId` names that task. */
export type Todos = { items: Todo[]; active: string; activeId: string }

/** What the main loop did to each file it touched (READ, EDITED, CREATED, DELETED bits), by a hash of its path: no path is kept. */
export type FileMarks = Record<string, number>

export type ProcKind = 'agent' | 'workflow' | 'wfagent' | 'shell' | 'monitor'

/** htop's letters: Running, Sleeping (waiting), eXited, Zombie (failed or killed). */
export type ProcState = 'R' | 'S' | 'X' | 'Z'

export type Proc = {
  /** agentId for agents, the task id for shells and monitors, the run id for workflows. */
  id: string
  /** What a task notification names it by. */
  taskId: string
  kind: ProcKind
  /** The workflow run of a workflow agent, the agent that spawned a nested one or a command; '' at the top. */
  parent: string
  type: string
  task: string
  state: ProcState
  /** Why it ended, when it did not end cleanly: `exit 1`, `killed`, `error`. */
  why: string
  startedAt: number
  endedAt: number | null
  changedAt: number
  tokOut: number
  ctx: number
  steps: number
  lastText: string
  /** A background command its agent's final answer ends, with no notification after it. */
  endsWithParent: boolean
  /** An agent the session started in the background, which alone can be stopped by its id; absent on a process stored before this field. */
  isBackground?: boolean
}

/**
 * One process's tool calls, kept apart from `procs` so a call writes only its own process's value:
 * the newest few, and how many it made in all.
 */
export type Timeline = { calls: ToolRow[]; total: number }

export type Fx = { frame: number }

declare module 'claude-code' {
  interface PluginState {
    glitchdeck: {
      history: Shaped<readonly HistoryEntry[]>
      view: Shaped<View>
      main: Shaped<Main>
      todos: Shaped<Todos>
      files: Shaped<FileMarks>
      procs: Shaped<readonly Proc[]>
      timeline: StateFamily<Timeline>
      fx: Shaped<Fx>
    }
  }
}
