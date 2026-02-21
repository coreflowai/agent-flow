import type Anthropic from '@anthropic-ai/sdk'
import { getIntegrationConfig } from '../../db/slack'
import { apiFetch, truncate, type ToolModule } from './types'

function getConfig(): { apiKey: string; appKey: string; site: string } | undefined {
  const config = getIntegrationConfig('datadog')
  const c = config?.config as any
  const apiKey = c?.apiKey || process.env.DD_API_KEY
  const appKey = c?.appKey || process.env.DD_APP_KEY
  const site = c?.site || process.env.DD_SITE || 'datadoghq.com'
  if (!apiKey) return undefined
  return { apiKey, appKey, site }
}

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'datadog_api',
    description: 'Make authenticated requests to the Datadog API. Auth headers (DD-API-KEY, DD-APPLICATION-KEY) are injected automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method' },
        path: { type: 'string', description: 'API path, e.g. /api/v2/logs/events/search' },
        body: { type: 'object', description: 'JSON body for POST requests (optional)' },
      },
      required: ['method', 'path'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  if (name !== 'datadog_api') return null

  const config = getConfig()
  if (!config) return 'Datadog not configured. Set API keys in the dashboard under Integrations → Datadog, or set DD_API_KEY / DD_APP_KEY environment variables.'

  const { method, path, body } = input as { method: string; path: string; body?: Record<string, unknown> }

  try {
    const url = `https://api.${config.site}${path}`
    const headers: Record<string, string> = {
      'DD-API-KEY': config.apiKey,
      'Content-Type': 'application/json',
    }
    if (config.appKey) headers['DD-APPLICATION-KEY'] = config.appKey

    const res = await apiFetch(url, {
      method: method.toUpperCase(),
      headers,
      body: method.toUpperCase() === 'POST' && body ? JSON.stringify(body) : undefined,
      timeoutMs: 15_000,
    })

    if (!res.ok) {
      const errText = await res.text()
      return `Datadog API error: HTTP ${res.status} ${res.statusText}\n${errText.slice(0, 2000)}`
    }

    const data = await res.text()
    return truncate(data)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Error: Datadog request timed out after 15 seconds'
    }
    return `Error calling Datadog API: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const datadogTools: ToolModule = { definitions, execute }
