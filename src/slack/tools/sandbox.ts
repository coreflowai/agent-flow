import type Anthropic from '@anthropic-ai/sdk'
import type { ToolModule } from './types'
import { truncate } from './types'
import type { SandboxManager } from '../../sandbox'

let _manager: SandboxManager | null = null

export function setSandboxManager(mgr: SandboxManager) {
  _manager = mgr
}

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'sandbox_create',
    description: 'Create a new cloud sandbox that can clone a repo and run Claude Agent SDK tasks. Returns the sandbox session ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo_url: { type: 'string', description: 'Git repository URL to clone into the sandbox' },
        branch: { type: 'string', description: 'Branch to checkout (default: main)' },
        label: { type: 'string', description: 'Human-readable label for this sandbox' },
        timeout_seconds: { type: 'number', description: 'Sandbox timeout in seconds (default: 3600)' },
      },
      required: [],
    },
  },
  {
    name: 'sandbox_status',
    description: 'Check the status of a sandbox session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Sandbox session ID' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'sandbox_dispatch_task',
    description: 'Send a prompt/task to an active sandbox. The sandbox runs Claude Agent SDK with the prompt and streams events back to AgentFlow in real-time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Sandbox session ID' },
        prompt: { type: 'string', description: 'Task prompt for the agent running inside the sandbox' },
        max_turns: { type: 'number', description: 'Maximum agent turns (default: 10)' },
      },
      required: ['session_id', 'prompt'],
    },
  },
  {
    name: 'sandbox_list',
    description: 'List all sandbox sessions with their status.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'sandbox_destroy',
    description: 'Tear down a sandbox session and release resources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Sandbox session ID' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'sandbox_create_pr',
    description: 'Create a GitHub PR from changes made in a sandbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Sandbox session ID' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description body' },
        base_branch: { type: 'string', description: 'Base branch (default: main)' },
        head_branch: { type: 'string', description: 'Head branch name (auto-generated if omitted)' },
      },
      required: ['session_id', 'title'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  if (!_manager) return 'Sandbox system not configured. Set up a sandbox provider in the dashboard.'

  switch (name) {
    case 'sandbox_create':
      return executeCreate(input)
    case 'sandbox_status':
      return executeStatus(input)
    case 'sandbox_dispatch_task':
      return executeDispatchTask(input)
    case 'sandbox_list':
      return executeList()
    case 'sandbox_destroy':
      return executeDestroy(input)
    case 'sandbox_create_pr':
      return executeCreatePR(input)
    default:
      return null
  }
}

async function executeCreate(input: Record<string, unknown>): Promise<string> {
  try {
    const record = await _manager!.createSession({
      repoUrl: input.repo_url as string | undefined,
      branch: input.branch as string | undefined,
      label: input.label as string | undefined,
      timeoutSeconds: input.timeout_seconds as number | undefined,
    })
    return JSON.stringify({
      session_id: record.id,
      sandbox_id: record.sandboxId,
      agent_flow_session_id: record.agentFlowSessionId,
      status: record.status,
      label: record.label,
    })
  } catch (err: any) {
    return `Error creating sandbox: ${err.message}`
  }
}

async function executeStatus(input: Record<string, unknown>): Promise<string> {
  const id = input.session_id as string
  try {
    const status = await _manager!.getStatus(id)
    if (!status) return `Sandbox session ${id} not found`
    return JSON.stringify(status)
  } catch (err: any) {
    return `Error getting status: ${err.message}`
  }
}

async function executeDispatchTask(input: Record<string, unknown>): Promise<string> {
  const id = input.session_id as string
  const prompt = input.prompt as string
  const maxTurns = input.max_turns as number | undefined
  try {
    const result = await _manager!.dispatchTask(id, { prompt, maxTurns })
    return truncate(JSON.stringify(result))
  } catch (err: any) {
    return `Error dispatching task: ${err.message}`
  }
}

async function executeList(): Promise<string> {
  const sessions = _manager!.listSessions()
  if (sessions.length === 0) return 'No sandbox sessions found.'
  const summary = sessions.map(s => ({
    id: s.id,
    label: s.label,
    status: s.status,
    provider: s.providerId,
    agent_flow_session_id: s.agentFlowSessionId,
    created: new Date(s.createdAt).toISOString(),
  }))
  return truncate(JSON.stringify(summary, null, 2))
}

async function executeDestroy(input: Record<string, unknown>): Promise<string> {
  const id = input.session_id as string
  try {
    await _manager!.destroySession(id)
    return `Sandbox session ${id} destroyed.`
  } catch (err: any) {
    return `Error destroying sandbox: ${err.message}`
  }
}

async function executeCreatePR(input: Record<string, unknown>): Promise<string> {
  const id = input.session_id as string
  const title = input.title as string
  const body = input.body as string | undefined
  const baseBranch = input.base_branch as string | undefined
  const headBranch = input.head_branch as string | undefined

  // Check if provider supports createPR
  const record = _manager!.getSession(id)
  if (!record) return `Sandbox session ${id} not found`

  try {
    // Use the sandbox manager's provider directly
    const { loadSandboxProvider } = await import('../../sandbox/provider-loader')
    const provider = await loadSandboxProvider()
    if (!provider.createPR) return 'Current sandbox provider does not support PR creation.'
    const result = await provider.createPR(record.sandboxId, { title, body, baseBranch, headBranch })
    return `PR created: ${result.prUrl}`
  } catch (err: any) {
    return `Error creating PR: ${err.message}`
  }
}

export const sandboxTools: ToolModule = { definitions, execute }
