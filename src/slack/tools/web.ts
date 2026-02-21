import type Anthropic from '@anthropic-ai/sdk'
import { truncate, type ToolModule } from './types'

const MAX_FETCH_SIZE = 30_000

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text content. Useful for reading links shared in conversation. Returns plain text with HTML tags stripped, truncated to 30KB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  if (name !== 'web_fetch') return null
  return executeWebFetch((input as { url: string }).url)
}

async function executeWebFetch(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AgentFlow-Bot/1.0' },
    })
    clearTimeout(timeout)

    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`

    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()

    let cleaned = text
    if (contentType.includes('html') || text.trimStart().startsWith('<')) {
      cleaned = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }

    return truncate(cleaned, MAX_FETCH_SIZE)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Error: Request timed out after 10 seconds'
    }
    return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const webTools: ToolModule = { definitions, execute }
