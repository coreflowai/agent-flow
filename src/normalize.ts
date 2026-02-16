import type { AgentFlowEvent, IngestPayload } from './types'

const MAX_OUTPUT_SIZE = 10_000

function truncate(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (str.length > MAX_OUTPUT_SIZE) {
    return str.slice(0, MAX_OUTPUT_SIZE) + `... [truncated, ${str.length} chars total]`
  }
  return value
}

function generateId(): string {
  return crypto.randomUUID()
}

export function normalizeClaudeCode(payload: IngestPayload): AgentFlowEvent {
  const { sessionId, event } = payload
  const hookEvent = (event.hook_event_name ?? event.event ?? event.type ?? '') as string
  const now = Date.now()

  const base: AgentFlowEvent = {
    id: generateId(),
    sessionId,
    timestamp: (event.timestamp as number) ?? now,
    source: 'claude-code',
    category: 'system',
    type: hookEvent,
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
  }

  switch (hookEvent) {
    case 'SessionStart':
    case 'session.start':
      return { ...base, category: 'session', type: 'session.start' }

    case 'Stop': {
      const stopText = (event.result ?? event.response ?? null) as string | null
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: stopText,
        meta: event.stop_reason ? { stop_reason: event.stop_reason } : {},
      }
    }

    case 'SessionEnd':
    case 'session.end':
      return { ...base, category: 'session', type: 'session.end' }

    case 'UserPromptSubmit':
    case 'message.user':
      return {
        ...base,
        category: 'message',
        type: 'message.user',
        role: 'user',
        text: (event.user_message ?? event.message ?? event.text ?? event.prompt ?? null) as string | null,
      }

    case 'PreToolUse':
    case 'tool.start':
      return {
        ...base,
        category: 'tool',
        type: 'tool.start',
        toolName: (event.tool_name ?? event.toolName ?? null) as string | null,
        toolInput: event.tool_input ?? event.toolInput ?? null,
      }

    case 'PostToolUse':
    case 'tool.end':
      return {
        ...base,
        category: 'tool',
        type: 'tool.end',
        toolName: (event.tool_name ?? event.toolName ?? null) as string | null,
        toolInput: event.tool_input ?? event.toolInput ?? null,
        toolOutput: truncate(event.tool_response ?? event.tool_output ?? event.toolOutput ?? null),
      }

    case 'message.assistant':
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: (event.message ?? event.text ?? null) as string | null,
      }

    case 'Error':
    case 'error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (event.error ?? event.message ?? null) as string | null,
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

export function normalizeCodex(payload: IngestPayload): AgentFlowEvent {
  const { sessionId, event } = payload
  const eventType = (event.type ?? '') as string
  const item = (event.item ?? {}) as Record<string, unknown>
  const itemType = (item.type ?? '') as string
  const now = Date.now()

  const base: AgentFlowEvent = {
    id: generateId(),
    sessionId,
    timestamp: (event.timestamp as number) ?? now,
    source: 'codex',
    category: 'system',
    type: eventType,
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
  }

  switch (eventType) {
    case 'thread.started':
      return { ...base, category: 'session', type: 'session.start' }

    case 'turn.started':
      return { ...base, category: 'system', type: 'turn.start' }

    case 'turn.completed':
      return { ...base, category: 'session', type: 'session.end' }

    case 'item.started':
      if (itemType === 'command_execution') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.start',
          toolName: 'command_execution',
          toolInput: item.command ?? null,
        }
      }
      if (itemType === 'file_change') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.start',
          toolName: 'file_change',
          toolInput: { file: item.file, patch: item.patch },
        }
      }
      if (itemType === 'agent_message') {
        return {
          ...base,
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: (item.content ?? null) as string | null,
        }
      }
      return { ...base, meta: { item } }

    case 'item.completed':
      if (itemType === 'command_execution') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName: 'command_execution',
          toolOutput: truncate(item.output ?? null),
        }
      }
      if (itemType === 'file_change') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName: 'file_change',
          toolOutput: truncate(item.patch ?? null),
        }
      }
      if (itemType === 'agent_message') {
        return {
          ...base,
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: (item.content ?? null) as string | null,
        }
      }
      return { ...base, meta: { item } }

    case 'error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (event.message ?? event.error ?? null) as string | null,
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

export function normalizeOpencode(payload: IngestPayload): AgentFlowEvent {
  const { sessionId, event } = payload
  const now = Date.now()

  const base: AgentFlowEvent = {
    id: generateId(),
    sessionId,
    timestamp: (event.timestamp as number) ?? now,
    source: 'opencode',
    category: 'system',
    type: (event.type ?? '') as string,
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
  }

  const properties = event.properties as Record<string, unknown> | undefined
  const isPluginEvent = properties !== undefined

  if (isPluginEvent) {
    return normalizeOpencodePlugin(base, event, properties!)
  }

  return normalizeOpencodeJsonl(base, event)
}

function normalizeOpencodePlugin(
  base: AgentFlowEvent,
  event: Record<string, unknown>,
  properties: Record<string, unknown>,
): AgentFlowEvent {
  const eventType = (event.type ?? '') as string
  const info = (properties.info ?? {}) as Record<string, unknown>

  switch (eventType) {
    case 'session.created':
      return {
        ...base,
        category: 'session',
        type: 'session.start',
        meta: info.title ? { title: info.title } : {},
      }

    case 'session.idle':
    case 'session.deleted':
      return { ...base, category: 'session', type: 'session.end' }

    case 'session.error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (properties.error ?? null) as string | null,
      }

    case 'session.status':
      return {
        ...base,
        category: 'system',
        type: 'session.status',
        meta: properties.status ? { status: properties.status } : {},
      }

    case 'message.updated': {
      const msg = (properties.info ?? properties.message ?? properties) as Record<string, unknown>
      const role = (msg.role ?? '') as string
      if (role === 'user') {
        return {
          ...base,
          category: 'message',
          type: 'message.user',
          role: 'user',
          text: (msg.content ?? msg.text ?? null) as string | null,
        }
      }
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: (msg.content ?? msg.text ?? null) as string | null,
      }
    }

    case 'message.part.updated': {
      const part = (properties.part ?? {}) as Record<string, unknown>
      const partType = (part.type ?? '') as string
      const status = (part.status ?? (part.state as Record<string, unknown>)?.status ?? '') as string

      if (partType === 'text') {
        return {
          ...base,
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: (part.text ?? part.content ?? null) as string | null,
        }
      }

      if (partType === 'tool' || partType === 'tool-invocation' || partType === 'tool_use') {
        const state = (part.state ?? {}) as Record<string, unknown>
        const toolName = (part.tool ?? part.toolName ?? part.tool_name ?? part.name ?? null) as string | null
        if (status === 'completed') {
          return {
            ...base,
            category: 'tool',
            type: 'tool.end',
            toolName,
            toolInput: state.input ?? part.toolInput ?? part.input ?? null,
            toolOutput: truncate(state.output ?? part.toolOutput ?? part.output ?? part.result ?? null),
            meta: state.title ? { title: state.title } : {},
          }
        }
        if (status === 'error') {
          return {
            ...base,
            category: 'tool',
            type: 'tool.end',
            toolName,
            toolInput: state.input ?? part.toolInput ?? part.input ?? null,
            error: (state.error ?? part.error ?? null) as string | null,
          }
        }
        // pending, running, or other
        return {
          ...base,
          category: 'tool',
          type: 'tool.start',
          toolName,
          toolInput: state.input ?? part.toolInput ?? part.input ?? null,
        }
      }

      return { ...base, meta: { rawEvent: event } }
    }

    case 'tool.execute.before':
      return {
        ...base,
        category: 'tool',
        type: 'tool.start',
        toolName: (event.tool ?? (properties as any).tool ?? null) as string | null,
        toolInput: event.args ?? (properties as any).args ?? null,
      }

    case 'tool.execute.after':
      return {
        ...base,
        category: 'tool',
        type: 'tool.end',
        toolName: (event.tool ?? (properties as any).tool ?? null) as string | null,
        toolInput: event.args ?? (properties as any).args ?? null,
        toolOutput: truncate(event.result ?? (properties as any).result ?? null),
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

function normalizeOpencodeJsonl(
  base: AgentFlowEvent,
  event: Record<string, unknown>,
): AgentFlowEvent {
  const eventType = (event.type ?? '') as string
  const part = (event.part ?? {}) as Record<string, unknown>
  const state = (part.state ?? {}) as Record<string, unknown>

  switch (eventType) {
    case 'step_start':
      return { ...base, category: 'system', type: 'step.start' }

    case 'step_finish':
      return { ...base, category: 'system', type: 'step.finish' }

    case 'text':
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: (part.text ?? event.text ?? null) as string | null,
      }

    case 'tool_use': {
      const toolName = (part.toolName ?? part.tool_name ?? part.name ?? null) as string | null
      const status = (state.status ?? '') as string
      if (status === 'completed') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName,
          toolOutput: truncate(state.output ?? state.result ?? null),
        }
      }
      if (status === 'error') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName,
          error: (state.error ?? null) as string | null,
        }
      }
      return {
        ...base,
        category: 'tool',
        type: 'tool.start',
        toolName,
        toolInput: state.input ?? part.input ?? null,
      }
    }

    case 'reasoning':
      return {
        ...base,
        category: 'system',
        type: 'reasoning',
        text: (part.text ?? event.text ?? null) as string | null,
      }

    case 'error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (event.error ?? event.message ?? null) as string | null,
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

export function normalize(payload: IngestPayload): AgentFlowEvent {
  if (payload.source === 'opencode') {
    return normalizeOpencode(payload)
  }
  if (payload.source === 'codex') {
    return normalizeCodex(payload)
  }
  return normalizeClaudeCode(payload)
}
