import { App } from '@slack/bolt'
import type { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { getQuestion, updateQuestionPosted } from '../db/slack'
import type { SlackQuestion } from '../types'
import { createChatHandler, chunkForSlack, type ChatHandler } from './chat'

export type SlackBotOptions = {
  botToken: string
  appToken: string
  channel: string
  io?: SocketIOServer
  internalBus?: EventEmitter
  dbPath?: string
  sourcesDbPath?: string
}

export type SlackChannel = {
  id: string
  name: string
  isPrivate: boolean
  numMembers: number
}

export type SlackBot = {
  start: () => Promise<void>
  stop: () => Promise<void>
  postQuestion: (questionId: string) => Promise<SlackQuestion | null>
  postNotification: (message: string) => Promise<void>
  replyInThread: (channelId: string, threadTs: string, text: string) => Promise<string | null>
  isConnected: () => boolean
  testConnection: () => Promise<{ ok: boolean; team?: string; user?: string; error?: string }>
  listChannels: () => Promise<SlackChannel[]>
  registerChannelListener: (channelId: string, cb: (msg: any, client?: any) => void) => void
  unregisterChannelListener: (channelId: string) => void
}

// Validate token with plain fetch — never touches @slack/bolt internals
async function validateSlackToken(botToken: string): Promise<{ ok: boolean; error?: string; team?: string; user?: string }> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return await res.json() as { ok: boolean; error?: string; team?: string; user?: string }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Network error' }
  }
}

export function createSlackBot(options: SlackBotOptions): SlackBot {
  const { botToken, appToken, channel, io, internalBus, dbPath, sourcesDbPath } = options
  let connected = false
  let app: App | null = null
  const channelListeners = new Map<string, (msg: any, client?: any) => void>()

  // Initialize chat handler if DB paths are available
  let chatHandler: ChatHandler | null = null
  if (dbPath) {
    chatHandler = createChatHandler({ dbPath, sourcesDbPath })
  }

  const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

  async function extractImages(message: any): Promise<Array<{ mediaType: string; data: string }>> {
    if (!message.files || !Array.isArray(message.files)) return []
    const images: Array<{ mediaType: string; data: string }> = []
    for (const file of message.files) {
      if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
        console.log(`[SlackBot] Skipping file "${file.name}" — unsupported mime type: ${file.mimetype}`)
        continue
      }
      if (file.size > MAX_IMAGE_SIZE) {
        console.log(`[SlackBot] Skipping file "${file.name}" — too large: ${(file.size / 1024 / 1024).toFixed(1)}MB`)
        continue
      }
      if (!file.url_private_download) {
        console.log(`[SlackBot] Skipping file "${file.name}" — no download URL`)
        continue
      }
      try {
        const res = await fetch(file.url_private_download, {
          headers: { 'Authorization': `Bearer ${botToken}` },
        })
        if (!res.ok) {
          console.error(`[SlackBot] Image download failed for "${file.name}": HTTP ${res.status}`)
          continue
        }
        const buf = await res.arrayBuffer()
        const base64 = Buffer.from(buf).toString('base64')
        images.push({ mediaType: file.mimetype, data: base64 })
        console.log(`[SlackBot] Image extracted: "${file.name}" (${file.mimetype}, ${(file.size / 1024).toFixed(0)}KB)`)
      } catch (err) {
        console.error('[SlackBot] Image download failed for', file.name, ':', err)
      }
    }
    return images
  }

  function setupListeners(a: App) {
    // Catch async errors from Socket Mode / Web API
    a.error(async (error) => {
      console.error('[SlackBot] Error:', error.message || error)
      connected = false
      if (io) io.emit('slack:status', { connected: false })
    })

    // @mention handler — start a chat thread with AI response
    a.event('app_mention', async ({ event, client }) => {
      try {
        await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: 'eyes' })
      } catch {}

      if (!chatHandler) return

      // Strip the @mention from the text
      const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()
      if (!text) return

      const threadTs = event.thread_ts || event.ts
      chatHandler.registerThread(threadTs)

      // Seed prior thread messages if this mention is inside an existing thread
      if (event.thread_ts) {
        try {
          const replies = await client.conversations.replies({
            channel: event.channel,
            ts: event.thread_ts,
          })
          if (replies.messages && replies.messages.length > 1) {
            // Resolve user names for prior messages and build history
            const priorMessages: Array<{ role: 'user' | 'assistant'; text: string }> = []
            for (const msg of replies.messages) {
              // Skip bot messages and the current message
              if ('bot_id' in msg && msg.bot_id) continue
              if (msg.ts === event.ts) continue
              if (!msg.text) continue

              let name = 'Unknown'
              if (msg.user) {
                try {
                  const info = await client.users.info({ user: msg.user })
                  name = info.user?.real_name || info.user?.name || 'Unknown'
                } catch {}
              }
              priorMessages.push({ role: 'user', text: `[${name}]: ${msg.text}` })
            }
            chatHandler.seedHistory(threadTs, priorMessages)
          }
        } catch (err) {
          console.error('[SlackBot] Failed to fetch thread history:', err)
        }
      }

      // Resolve user name
      let userName: string | undefined
      if (event.user) {
        try {
          const userInfo = await client.users.info({ user: event.user })
          userName = userInfo.user?.real_name || userInfo.user?.name
        } catch {}
      }

      // Extract images from the message
      const images = await extractImages(event)

      // Show hourglass while processing
      try {
        await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: 'hourglass' })
      } catch {}

      try {
        const reply = await chatHandler.handleMessage(threadTs, text, userName, images.length > 0 ? images : undefined)
        const chunks = chunkForSlack(reply)
        for (const chunk of chunks) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: chunk,
          })
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[SlackBot] Chat handler error:', err)
        try {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: `Something went wrong: \`${errMsg}\``,
          })
        } catch {}
      }

      // Remove hourglass
      try {
        await client.reactions.remove({ channel: event.channel, timestamp: event.ts, name: 'hourglass' })
      } catch {}
    })

    // Thread reply listener — accumulates replies and asks permission to refine
    a.message(async ({ message, client }) => {
      // Dispatch to registered channel listeners (for data source ingestion)
      if ('channel' in message && message.channel) {
        const channelCb = channelListeners.get(message.channel)
        if (channelCb) {
          try { channelCb(message, client) } catch {}
        }
      }

      if (!('thread_ts' in message) || !message.thread_ts) return
      if (!('channel' in message) || !message.channel) return
      if ('bot_id' in message && message.bot_id) return
      const hasText = 'text' in message && message.text
      const hasFiles = 'files' in message && Array.isArray((message as any).files) && (message as any).files.length > 0
      if (!hasText && !hasFiles) return

      // Route chat thread follow-ups (no @mention needed)
      if (chatHandler && chatHandler.isChatThread(message.thread_ts)) {
        // React to acknowledge
        try {
          if ('ts' in message && message.ts) {
            await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'eyes' })
          }
        } catch {}

        let userName: string | undefined
        if ('user' in message && message.user) {
          try {
            const userInfo = await client.users.info({ user: message.user })
            userName = userInfo.user?.real_name || userInfo.user?.name
          } catch {}
        }

        // Extract images from the message
        const images = await extractImages(message)

        // Show hourglass
        try {
          if ('ts' in message && message.ts) {
            await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'hourglass' })
          }
        } catch {}

        try {
          const msgText = ('text' in message && message.text) ? message.text : '(shared an image)'
          const reply = await chatHandler.handleMessage(message.thread_ts, msgText, userName, images.length > 0 ? images : undefined)
          const chunks = chunkForSlack(reply)
          for (const chunk of chunks) {
            await client.chat.postMessage({
              channel: message.channel,
              thread_ts: message.thread_ts,
              text: chunk,
            })
          }
        } catch (err) {
          console.error('[SlackBot] Chat follow-up error:', err)
        }

        // Remove hourglass
        try {
          if ('ts' in message && message.ts) {
            await client.reactions.remove({ channel: message.channel, timestamp: message.ts, name: 'hourglass' })
          }
        } catch {}

        return // Don't fall through to question-thread handling
      }

    })
  }

  async function postQuestion(questionId: string): Promise<SlackQuestion | null> {
    if (!app) return null
    const question = getQuestion(questionId)
    if (!question) return null

    const targetChannel = question.channelId || channel

    // Always post as casual plain text — registered as chat thread so Benny handles replies
    const result = await app.client.chat.postMessage({
      channel: targetChannel,
      text: question.question,
    })

    try {
      if (result.ts) {
        updateQuestionPosted(question.id, targetChannel, result.ts)

        if (chatHandler) {
          chatHandler.registerThread(result.ts)
        }

        const updated = getQuestion(question.id)
        if (updated && io) {
          io.emit('slack:question:posted', updated)
        }
        return updated
      }
    } catch (err) {
      console.error('Failed to post question to Slack:', err)
    }

    return question
  }

  async function testConnection(): Promise<{ ok: boolean; team?: string; user?: string; error?: string }> {
    const result = await validateSlackToken(botToken)
    if (result.ok) {
      return { ok: true, team: result.team, user: result.user }
    }
    return { ok: false, error: result.error || 'Connection failed' }
  }

  async function listChannels(): Promise<SlackChannel[]> {
    if (!app) return []
    const channels: SlackChannel[] = []
    let cursor: string | undefined
    do {
      const result = await app.client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      })
      for (const ch of result.channels || []) {
        channels.push({
          id: ch.id!,
          name: ch.name || ch.id!,
          isPrivate: ch.is_private || false,
          numMembers: ch.num_members || 0,
        })
      }
      cursor = result.response_metadata?.next_cursor || undefined
    } while (cursor)
    return channels
  }

  return {
    start: async () => {
      // Validate bot token with plain fetch first — if invalid, bail early
      const authResult = await validateSlackToken(botToken)
      if (!authResult.ok) {
        throw new Error(`Slack auth failed: ${authResult.error}`)
      }

      // Validate app token format — must be xapp- for Socket Mode
      if (!appToken.startsWith('xapp-')) {
        throw new Error(`Slack app token must start with xapp- (got ${appToken.slice(0, 6)}...)`)
      }

      // Only now construct the App — tokens are valid
      app = new App({ token: botToken, appToken, socketMode: true })
      setupListeners(app)

      await app.start()
      connected = true
      if (io) io.emit('slack:status', { connected: true })
      console.log(`Slack bot connected (Socket Mode) — team: ${authResult.team}`)
    },
    stop: async () => {
      connected = false
      if (io) io.emit('slack:status', { connected: false })
      if (chatHandler) chatHandler.cleanup()
      if (app) await app.stop()
      app = null
    },
    postQuestion,
    listChannels,
    postNotification: async (message: string) => {
      if (!app) return
      try {
        await app.client.chat.postMessage({ channel, text: message })
      } catch (err) {
        console.error('[SlackBot] Failed to post notification:', err)
      }
    },
    replyInThread: async (channelId: string, threadTs: string, text: string) => {
      if (!app) return null
      try {
        const result = await app.client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text,
        })
        return result.ts ?? null
      } catch (err) {
        console.error('[SlackBot] Failed to reply in thread:', err)
        return null
      }
    },
    isConnected: () => connected,
    testConnection,
    registerChannelListener: (channelId: string, cb: (msg: any, client?: any) => void) => {
      channelListeners.set(channelId, cb)
    },
    unregisterChannelListener: (channelId: string) => {
      channelListeners.delete(channelId)
    },
  }
}
