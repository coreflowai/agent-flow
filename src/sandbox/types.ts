export type SandboxProvider = {
  name: string

  /** Spin up sandbox, clone repo, prepare environment */
  createSession(opts: CreateSessionOpts): Promise<SandboxSession>
  /** Get live status from the provider */
  getStatus(sandboxId: string): Promise<SandboxStatus>
  /** Run Claude Agent SDK with a prompt inside the sandbox */
  dispatchTask(sandboxId: string, task: SandboxTask): Promise<SandboxTaskResult>
  /** Tear down sandbox */
  destroySession(sandboxId: string): Promise<void>

  // Optional capabilities
  resumeSession?(sandboxId: string): Promise<SandboxSession>
  snapshotSession?(sandboxId: string): Promise<{ snapshotId: string }>
  queueMessage?(sandboxId: string, message: string): Promise<void>
  createPR?(sandboxId: string, opts: CreatePROpts): Promise<{ prUrl: string }>
}

export type CreateSessionOpts = {
  repoUrl?: string
  branch?: string
  patch?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  label?: string
  // Injected by SandboxManager -- provider MUST forward to sandbox env:
  agentFlowUrl: string
  agentFlowSessionId: string
  agentFlowApiKey?: string
}

export type SandboxSession = {
  sandboxId: string
  status: SandboxSessionStatus
  metadata?: Record<string, unknown>
}

export type SandboxSessionStatus =
  | 'creating' | 'running' | 'idle'
  | 'snapshotted' | 'error' | 'destroyed'

export type SandboxStatus = {
  status: SandboxSessionStatus
  uptime?: number
  lastActivity?: number
  error?: string
}

export type SandboxTask = {
  prompt: string
  maxTurns?: number
}

export type SandboxTaskResult = {
  taskId: string
  status: 'completed' | 'error' | 'timeout'
  result?: string
  error?: string
  durationMs?: number
}

export type CreatePROpts = {
  title: string
  body?: string
  baseBranch?: string
  headBranch?: string
}
