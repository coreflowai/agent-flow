import type { Server as SocketIOServer } from 'socket.io'
import type { CreateSessionOpts, SandboxTask, SandboxTaskResult, CreatePROpts, SandboxSessionStatus } from './types'
import { loadSandboxProvider } from './provider-loader'
import { addSandboxSession, getSandboxSession, listSandboxSessions, updateSandboxSessionStatus, deleteSandboxSession, type SandboxSessionRecord } from '../db/sandbox'
import { addEvent } from '../db'
import { getIntegrationConfig } from '../db/slack'

export type SandboxManager = {
  createSession(opts: { repoUrl?: string; branch?: string; patch?: string; env?: Record<string, string>; timeoutSeconds?: number; label?: string }): Promise<SandboxSessionRecord>
  dispatchTask(id: string, task: SandboxTask): Promise<SandboxTaskResult>
  getStatus(id: string): Promise<{ status: SandboxSessionStatus; uptime?: number; lastActivity?: number; error?: string } | null>
  destroySession(id: string): Promise<void>
  listSessions(): SandboxSessionRecord[]
  getSession(id: string): SandboxSessionRecord | null
  resumeSession?(id: string): Promise<SandboxSessionRecord | null>
  snapshotSession?(id: string): Promise<{ snapshotId: string } | null>
  queueMessage?(id: string, message: string): Promise<void>
  createPR?(id: string, opts: CreatePROpts): Promise<{ prUrl: string } | null>
}

export type SandboxManagerOptions = {
  io: SocketIOServer
  agentFlowUrl: string
  agentFlowApiKey?: string
}

export function createSandboxManager(options: SandboxManagerOptions): SandboxManager {
  const { io, agentFlowUrl, agentFlowApiKey } = options

  function emitSyntheticEvent(sessionId: string, type: string, meta: Record<string, unknown> = {}) {
    const event = {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      source: 'sandbox' as const,
      category: 'system' as const,
      type,
      role: null,
      text: null,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      error: null,
      meta,
    }
    addEvent(event)
    io.to(`session:${sessionId}`).emit('event', event)
  }

  return {
    async createSession(opts) {
      const provider = await loadSandboxProvider()

      const id = crypto.randomUUID()
      const agentFlowSessionId = crypto.randomUUID()

      // Create AgentFlow session via session.start event
      const startEvent = {
        id: crypto.randomUUID(),
        sessionId: agentFlowSessionId,
        timestamp: Date.now(),
        source: 'sandbox' as const,
        category: 'session' as const,
        type: 'session.start',
        role: null,
        text: null,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        error: null,
        meta: {
          sandboxId: id,
          provider: provider.name,
          ...(opts.label ? { label: opts.label } : {}),
          ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
          ...(opts.branch ? { branch: opts.branch } : {}),
        },
      }
      addEvent(startEvent)
      io.to(`session:${agentFlowSessionId}`).emit('event', startEvent)
      io.emit('session:update', { id: agentFlowSessionId, source: 'sandbox', status: 'active' })

      // Build provider opts with injected AgentFlow connection info
      const providerOpts: CreateSessionOpts = {
        ...opts,
        agentFlowUrl,
        agentFlowSessionId,
        agentFlowApiKey,
      }

      // Call provider to create the actual sandbox
      const result = await provider.createSession(providerOpts)

      // Store in DB
      const record = addSandboxSession({
        id,
        sandboxId: result.sandboxId,
        providerId: provider.name,
        agentFlowSessionId,
        status: result.status,
        config: {
          repoUrl: opts.repoUrl,
          branch: opts.branch,
          timeoutSeconds: opts.timeoutSeconds,
        },
        label: opts.label,
        metadata: result.metadata,
      })

      io.emit('sandbox:created', record)
      return record
    },

    async dispatchTask(id, task) {
      const record = getSandboxSession(id)
      if (!record) throw new Error(`Sandbox session ${id} not found`)

      const provider = await loadSandboxProvider()

      // Emit task start
      emitSyntheticEvent(record.agentFlowSessionId, 'sandbox.task.start', {
        prompt: task.prompt.slice(0, 500),
        maxTurns: task.maxTurns,
      })

      updateSandboxSessionStatus(id, 'running')

      const startTime = Date.now()
      let result: SandboxTaskResult
      try {
        result = await provider.dispatchTask(record.sandboxId, task)
      } catch (err: any) {
        result = {
          taskId: crypto.randomUUID(),
          status: 'error',
          error: err.message ?? 'Task dispatch failed',
          durationMs: Date.now() - startTime,
        }
      }

      // Emit task end
      emitSyntheticEvent(record.agentFlowSessionId, 'sandbox.task.end', {
        taskId: result.taskId,
        status: result.status,
        durationMs: result.durationMs,
        ...(result.error ? { error: result.error } : {}),
      })

      updateSandboxSessionStatus(id, result.status === 'error' ? 'error' : 'idle')
      return result
    },

    async getStatus(id) {
      const record = getSandboxSession(id)
      if (!record) return null

      const provider = await loadSandboxProvider()
      try {
        return await provider.getStatus(record.sandboxId)
      } catch {
        return { status: record.status }
      }
    },

    async destroySession(id) {
      const record = getSandboxSession(id)
      if (!record) return

      const provider = await loadSandboxProvider()
      try {
        await provider.destroySession(record.sandboxId)
      } catch (err) {
        console.error(`[SandboxManager] Failed to destroy sandbox ${record.sandboxId}:`, err)
      }

      emitSyntheticEvent(record.agentFlowSessionId, 'session.end', { reason: 'destroyed' })
      updateSandboxSessionStatus(id, 'destroyed')
      io.emit('sandbox:destroyed', { id })
    },

    listSessions() {
      return listSandboxSessions()
    },

    getSession(id) {
      return getSandboxSession(id)
    },
  }
}
