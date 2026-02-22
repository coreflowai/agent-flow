import type { SandboxProvider, CreateSessionOpts, SandboxSession, SandboxStatus, SandboxTask, SandboxTaskResult, CreatePROpts } from '../types'

// Runner script injected into each sandbox
const RUNNER_SCRIPT = `
const { query } = await import('@anthropic-ai/claude-code')

const agentFlowUrl = process.env.AGENT_FLOW_URL
const sessionId = process.env.AGENT_FLOW_SESSION_ID
const apiKey = process.env.AGENT_FLOW_API_KEY

async function postEvent(event) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['x-api-key'] = apiKey
  await fetch(agentFlowUrl + '/api/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'sandbox', sessionId, event }),
  }).catch(() => {})
}

const hooks = {
  onSessionStart: (e) => postEvent({ ...e, hook_event_name: 'SessionStart' }),
  onUserPromptSubmit: (e) => postEvent({ ...e, hook_event_name: 'UserPromptSubmit' }),
  onPreToolUse: (e) => postEvent({ ...e, hook_event_name: 'PreToolUse' }),
  onPostToolUse: (e) => postEvent({ ...e, hook_event_name: 'PostToolUse' }),
  onStop: (e) => postEvent({ ...e, hook_event_name: 'Stop' }),
}

const task = JSON.parse(await Bun.file('/workspace/task.json').text())
const result = await query({
  prompt: task.prompt,
  options: {
    hooks,
    maxTurns: task.maxTurns ?? 10,
    cwd: '/workspace/repo',
  },
})

await Bun.write('/workspace/result.json', JSON.stringify({
  status: 'completed',
  result: typeof result === 'string' ? result : JSON.stringify(result),
}))
`

// Modal is loaded dynamically since it may not be installed
let modalModule: any = null

async function getModal() {
  if (!modalModule) {
    try {
      modalModule = await import('modal')
    } catch {
      throw new Error('Modal SDK not installed. Run: npm install modal')
    }
  }
  return modalModule
}

const APP_NAME = 'agentflow-sandbox'

export const name = 'modal'

export async function createSession(opts: CreateSessionOpts): Promise<SandboxSession> {
  const modal = await getModal()

  const app = await modal.App.lookup(APP_NAME, { createIfMissing: true })

  // Build image: python base + git + bun + claude-code
  const image = modal.Image.from_registry('python:3.11-slim')
    .apt_install('git', 'curl', 'ca-certificates')
    .run_commands(
      'curl -fsSL https://bun.sh/install | bash',
      'ln -s /root/.bun/bin/bun /usr/local/bin/bun',
      'npm install -g @anthropic-ai/claude-code',
    )

  const timeoutMs = (opts.timeoutSeconds ?? 3600) * 1000

  // Environment variables for the sandbox
  const envVars: Record<string, string> = {
    AGENT_FLOW_URL: opts.agentFlowUrl,
    AGENT_FLOW_SESSION_ID: opts.agentFlowSessionId,
    ...(opts.agentFlowApiKey ? { AGENT_FLOW_API_KEY: opts.agentFlowApiKey } : {}),
    ...(opts.env ?? {}),
  }

  const sb = await modal.Sandbox.create(app, {
    image,
    cpu: 2,
    memory: 4096,
    timeout: timeoutMs,
    encrypted_ports: [443],
    env: envVars,
  })

  // Clone repo if specified
  if (opts.repoUrl) {
    await sb.exec(['git', 'clone', '--depth', '1', opts.repoUrl, '/workspace/repo'])

    if (opts.branch) {
      await sb.exec(['git', '-C', '/workspace/repo', 'fetch', 'origin', opts.branch])
      await sb.exec(['git', '-C', '/workspace/repo', 'checkout', opts.branch])
    }
  } else {
    await sb.exec(['mkdir', '-p', '/workspace/repo'])
  }

  // Apply patch if provided
  if (opts.patch) {
    const patchFile = sb.open('/workspace/patch.diff', 'w')
    await patchFile.write(opts.patch)
    await patchFile.close()
    await sb.exec(['git', '-C', '/workspace/repo', 'apply', '/workspace/patch.diff'])
  }

  // Write runner script
  const runnerFile = sb.open('/workspace/runner.ts', 'w')
  await runnerFile.write(RUNNER_SCRIPT)
  await runnerFile.close()

  return {
    sandboxId: sb.sandbox_id,
    status: 'running',
    metadata: {
      appName: APP_NAME,
      repoUrl: opts.repoUrl,
      branch: opts.branch,
    },
  }
}

export async function getStatus(sandboxId: string): Promise<SandboxStatus> {
  const modal = await getModal()

  try {
    const sb = await modal.Sandbox.from_id(sandboxId)
    // Check if sandbox is still running
    const info = await sb.poll()
    if (info.returncode !== undefined) {
      return { status: 'destroyed' }
    }
    return { status: 'running' }
  } catch {
    return { status: 'error', error: 'Failed to query sandbox status' }
  }
}

export async function dispatchTask(sandboxId: string, task: SandboxTask): Promise<SandboxTaskResult> {
  const modal = await getModal()
  const taskId = crypto.randomUUID()
  const startTime = Date.now()

  try {
    const sb = await modal.Sandbox.from_id(sandboxId)

    // Write task to file
    const taskFile = sb.open('/workspace/task.json', 'w')
    await taskFile.write(JSON.stringify({
      prompt: task.prompt,
      maxTurns: task.maxTurns ?? 10,
    }))
    await taskFile.close()

    // Run the runner script
    const proc = await sb.exec(['bun', 'run', '/workspace/runner.ts'])

    // Read result
    try {
      const resultFile = sb.open('/workspace/result.json', 'r')
      const resultText = await resultFile.read()
      await resultFile.close()
      const resultData = JSON.parse(resultText)

      return {
        taskId,
        status: resultData.status ?? 'completed',
        result: resultData.result,
        durationMs: Date.now() - startTime,
      }
    } catch {
      return {
        taskId,
        status: 'completed',
        result: 'Task completed (no result file)',
        durationMs: Date.now() - startTime,
      }
    }
  } catch (err: any) {
    return {
      taskId,
      status: 'error',
      error: err.message ?? 'Failed to dispatch task',
      durationMs: Date.now() - startTime,
    }
  }
}

export async function destroySession(sandboxId: string): Promise<void> {
  const modal = await getModal()
  try {
    const sb = await modal.Sandbox.from_id(sandboxId)
    await sb.terminate()
  } catch {
    // Already terminated or not found
  }
}

export async function createPR(sandboxId: string, opts: CreatePROpts): Promise<{ prUrl: string }> {
  const modal = await getModal()
  const sb = await modal.Sandbox.from_id(sandboxId)

  const headBranch = opts.headBranch ?? `sandbox/${crypto.randomUUID().slice(0, 8)}`
  const baseBranch = opts.baseBranch ?? 'main'

  await sb.exec(['git', '-C', '/workspace/repo', 'checkout', '-b', headBranch])
  await sb.exec(['git', '-C', '/workspace/repo', 'add', '-A'])
  await sb.exec(['git', '-C', '/workspace/repo', 'commit', '-m', opts.title])
  await sb.exec(['git', '-C', '/workspace/repo', 'push', 'origin', headBranch])

  // Create PR via GitHub API using gh CLI (if available in sandbox)
  const body = opts.body ?? opts.title
  const proc = await sb.exec([
    'gh', 'pr', 'create',
    '--title', opts.title,
    '--body', body,
    '--base', baseBranch,
    '--head', headBranch,
  ], { cwd: '/workspace/repo' })

  // Parse PR URL from stdout
  const stdout = proc.stdout?.toString().trim() ?? ''
  const prUrl = stdout.match(/https:\/\/github\.com\/[^\s]+/)?.[0] ?? stdout
  return { prUrl }
}

const modalProvider: SandboxProvider = {
  name,
  createSession,
  getStatus,
  dispatchTask,
  destroySession,
  createPR,
}

export default modalProvider
