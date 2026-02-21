import type Anthropic from '@anthropic-ai/sdk'
import { getIntegrationConfig } from '../../db/slack'
import { apiFetch, truncate, type ToolModule } from './types'

const SLACK_API = 'https://slack.com/api'

function getToken(): string | undefined {
  const config = getIntegrationConfig('slack')
  return (config?.config as any)?.botToken
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'slack_list_channels',
    description: 'List Slack channels the bot has access to.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max channels to return (max 200). Defaults to 50.' },
        types: { type: 'string', description: 'Comma-separated channel types: public_channel, private_channel. Defaults to "public_channel,private_channel".' },
      },
      required: [],
    },
  },
  {
    name: 'slack_read_messages',
    description: 'Read recent messages from a Slack channel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: { type: 'string', description: 'Channel ID (e.g. C012345)' },
        limit: { type: 'number', description: 'Number of messages (max 50). Defaults to 20.' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'slack_search_messages',
    description: 'Search Slack messages. Requires a Slack user token with search:read scope (bot tokens cannot search).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (Slack search syntax supported)' },
        count: { type: 'number', description: 'Max results (max 20). Defaults to 10.' },
      },
      required: ['query'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  const token = getToken()
  if (!token) return 'Slack bot not configured. Set the bot token in the dashboard under Integrations → Slack.'

  const headers = authHeaders(token)

  switch (name) {
    case 'slack_list_channels': return executeListChannels(input as any, headers)
    case 'slack_read_messages': return executeReadMessages(input as any, headers)
    case 'slack_search_messages': return executeSearchMessages(input as any, headers)
    default: return null
  }
}

async function executeListChannels(
  input: { limit?: number; types?: string },
  headers: Record<string, string>,
): Promise<string> {
  const limit = Math.min(input.limit || 50, 200)
  const types = input.types || 'public_channel,private_channel'
  const url = `${SLACK_API}/conversations.list?limit=${limit}&types=${encodeURIComponent(types)}&exclude_archived=true`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `Slack API error: HTTP ${res.status}`

  const data = await res.json() as any
  if (!data.ok) return `Slack API error: ${data.error}`
  if (!data.channels || data.channels.length === 0) return 'No channels found.'

  const lines = data.channels.map((ch: any) => {
    const members = ch.num_members != null ? ` (${ch.num_members} members)` : ''
    const purpose = ch.purpose?.value ? ` — ${ch.purpose.value.slice(0, 60)}` : ''
    return `- #${ch.name}${members}${purpose} (ID: ${ch.id})`
  })
  return lines.join('\n')
}

async function executeReadMessages(
  input: { channel: string; limit?: number },
  headers: Record<string, string>,
): Promise<string> {
  const limit = Math.min(input.limit || 20, 50)
  const url = `${SLACK_API}/conversations.history?channel=${input.channel}&limit=${limit}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `Slack API error: HTTP ${res.status}`

  const data = await res.json() as any
  if (!data.ok) return `Slack API error: ${data.error}`
  if (!data.messages || data.messages.length === 0) return 'No messages in this channel.'

  // Messages come newest-first, reverse for chronological order
  const messages = data.messages.reverse()
  const lines = messages.map((m: any) => {
    const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 19).replace('T', ' ') : ''
    const user = m.user || m.bot_id || 'unknown'
    const text = m.text || '(no text)'
    return `[${time}] <@${user}>: ${text}`
  })
  return truncate(lines.join('\n'))
}

async function executeSearchMessages(
  input: { query: string; count?: number },
  headers: Record<string, string>,
): Promise<string> {
  const count = Math.min(input.count || 10, 20)
  const url = `${SLACK_API}/search.messages?query=${encodeURIComponent(input.query)}&count=${count}`

  const res = await apiFetch(url, { headers })
  if (!res.ok) return `Slack API error: HTTP ${res.status}`

  const data = await res.json() as any
  if (!data.ok) {
    if (data.error === 'missing_scope' || data.error === 'not_allowed_token_type') {
      return 'Slack search requires a user token with search:read scope. Bot tokens cannot search messages.'
    }
    return `Slack API error: ${data.error}`
  }

  const matches = data.messages?.matches
  if (!matches || matches.length === 0) return `No results found for "${input.query}"`

  const lines = matches.map((m: any) => {
    const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 10) : ''
    const channel = m.channel?.name ? `#${m.channel.name}` : ''
    const user = m.user || m.username || 'unknown'
    const text = m.text?.slice(0, 200) || '(no text)'
    return `- [${time}] ${channel} <@${user}>: ${text}`
  })

  const total = data.messages?.total || matches.length
  return `Found ${total} results:\n${lines.join('\n')}`
}

export const slackApiTools: ToolModule = { definitions, execute }
