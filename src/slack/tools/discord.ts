import type Anthropic from '@anthropic-ai/sdk'
import { getIntegrationConfig } from '../../db/slack'
import { apiFetch, truncate, type ToolModule } from './types'

const DISCORD_API = 'https://discord.com/api/v10'

function getToken(): string | undefined {
  const config = getIntegrationConfig('discord')
  return (config?.config as any)?.botToken
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bot ${token}` }
}

const definitions: Anthropic.Messages.Tool[] = [
  {
    name: 'discord_list_guilds',
    description: 'List Discord servers (guilds) the bot is a member of.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'discord_list_channels',
    description: 'List text channels in a Discord guild.',
    input_schema: {
      type: 'object' as const,
      properties: {
        guild_id: { type: 'string', description: 'The Discord guild (server) ID' },
      },
      required: ['guild_id'],
    },
  },
  {
    name: 'discord_read_messages',
    description: 'Read recent messages from a Discord channel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel_id: { type: 'string', description: 'The Discord channel ID' },
        limit: { type: 'number', description: 'Number of messages to fetch (max 50). Defaults to 20.' },
      },
      required: ['channel_id'],
    },
  },
]

async function execute(name: string, input: Record<string, unknown>): Promise<string | null> {
  const token = getToken()
  if (!token) return 'Discord bot not configured. Set the bot token in the dashboard under Integrations → Discord.'

  const headers = authHeaders(token)

  switch (name) {
    case 'discord_list_guilds': return executeListGuilds(headers)
    case 'discord_list_channels': return executeListChannels(input as any, headers)
    case 'discord_read_messages': return executeReadMessages(input as any, headers)
    default: return null
  }
}

async function executeListGuilds(headers: Record<string, string>): Promise<string> {
  const res = await apiFetch(`${DISCORD_API}/users/@me/guilds`, { headers })
  if (!res.ok) return `Discord API error: HTTP ${res.status} ${res.statusText}`

  const guilds = await res.json() as any[]
  if (guilds.length === 0) return 'Bot is not in any Discord servers.'

  const lines = guilds.map((g: any) => `- **${g.name}** (ID: ${g.id})`)
  return lines.join('\n')
}

async function executeListChannels(
  input: { guild_id: string },
  headers: Record<string, string>,
): Promise<string> {
  const res = await apiFetch(`${DISCORD_API}/guilds/${input.guild_id}/channels`, { headers })
  if (!res.ok) return `Discord API error: HTTP ${res.status} ${res.statusText}`

  const channels = await res.json() as any[]
  // Type 0 = text channels, type 5 = announcement
  const textChannels = channels.filter((c: any) => c.type === 0 || c.type === 5)
  if (textChannels.length === 0) return 'No text channels found in this guild.'

  const lines = textChannels.map((c: any) => {
    const topic = c.topic ? ` — ${c.topic.slice(0, 60)}` : ''
    return `- #${c.name}${topic} (ID: ${c.id})`
  })
  return lines.join('\n')
}

async function executeReadMessages(
  input: { channel_id: string; limit?: number },
  headers: Record<string, string>,
): Promise<string> {
  const limit = Math.min(input.limit || 20, 50)
  const res = await apiFetch(`${DISCORD_API}/channels/${input.channel_id}/messages?limit=${limit}`, { headers })
  if (!res.ok) return `Discord API error: HTTP ${res.status} ${res.statusText}`

  const messages = await res.json() as any[]
  if (messages.length === 0) return 'No messages in this channel.'

  // Messages come newest-first, reverse for chronological order
  const lines = messages.reverse().map((m: any) => {
    const time = m.timestamp?.slice(0, 19).replace('T', ' ')
    const content = m.content || '(no text content)'
    const attachments = m.attachments?.length ? ` [${m.attachments.length} attachment(s)]` : ''
    return `[${time}] **${m.author?.username}**: ${content}${attachments}`
  })
  return truncate(lines.join('\n'))
}

export const discordTools: ToolModule = { definitions, execute }
