import type Anthropic from '@anthropic-ai/sdk'

export const MAX_TOOL_RESULT = 30_000

export type ToolModule = {
  definitions: Anthropic.Messages.Tool[]
  execute: (name: string, input: Record<string, unknown>) => Promise<string | null>
}

/**
 * Fetch helper with timeout and error handling for external APIs.
 */
export async function apiFetch(
  url: string,
  opts: {
    headers?: Record<string, string>
    method?: string
    body?: string
    timeoutMs?: number
  } = {},
): Promise<Response> {
  const { headers = {}, method = 'GET', body, timeoutMs = 10_000 } = opts
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      headers: { 'User-Agent': 'AgentFlow-Bot/1.0', ...headers },
      body,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export function truncate(text: string, max = MAX_TOOL_RESULT): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '\n... (truncated)'
}
