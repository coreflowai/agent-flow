import { App } from '@slack/bolt'
import type { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { getQuestion, updateQuestionPosted, updateQuestionAnswer, findQuestionByThread, addThreadReply } from '../db/slack'
import type { SlackQuestion, SlackQuestionOption } from '../types'
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
      if (!IMAGE_MIME_TYPES.has(file.mimetype)) continue
      if (file.size > MAX_IMAGE_SIZE) continue
      if (!file.url_private_download) continue
      try {
        const res = await fetch(file.url_private_download, {
          headers: { 'Authorization': `Bearer ${botToken}` },
        })
        if (!res.ok) continue
        const buf = await res.arrayBuffer()
        const base64 = Buffer.from(buf).toString('base64')
        images.push({ mediaType: file.mimetype, data: base64 })
      } catch {}
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

      const question = findQuestionByThread(message.channel, message.thread_ts)
      if (!question) return
      if (question.status === 'expired') return

      // React to acknowledge the reply
      try {
        if ('ts' in message && message.ts) {
          await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'eyes' })
        }
      } catch {}

      // Resolve user name
      let userName: string | undefined
      if ('user' in message && message.user) {
        try {
          const userInfo = await client.users.info({ user: message.user })
          userName = userInfo.user?.real_name || userInfo.user?.name
        } catch {}
      }

      // Accumulate reply in DB (meta.threadReplies)
      addThreadReply(question.id, {
        text: ('text' in message ? message.text : '') || '',
        userId: ('user' in message ? message.user : undefined) || 'unknown',
        userName,
        ts: ('ts' in message ? message.ts : undefined) as string,
        receivedAt: Date.now(),
      })

      console.log(`[SlackBot] Thread reply accumulated for question ${question.id} from ${userName || 'unknown'}`)

      // Instant reply with a "Refine insight" button
      try {
        await client.chat.postMessage({
          channel: message.channel,
          thread_ts: message.thread_ts,
          text: `Got it, thanks ${userName ? userName : ''}! Want me to update the insight with your feedback?`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Got it, thanks${userName ? ` ${userName}` : ''}! Want me to update the insight with your feedback?`,
              },
            },
            {
              type: 'actions',
              block_id: `refine_${question.id}`,
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Refine insight' },
                  action_id: 'refine_insight',
                  value: question.id,
                  style: 'primary',
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Not now' },
                  action_id: 'refine_skip',
                  value: question.id,
                },
              ],
            },
          ],
        })
      } catch (err) {
        console.error('[SlackBot] Failed to post refine prompt:', err)
      }
    })

    // Button click listener — matches action IDs starting with slack_q_
    a.action(/^slack_q_/, async ({ action, body, ack, client }) => {
      await ack()

      if (action.type !== 'button') return
      const optionId = action.value || ''
      const questionId = action.block_id || ''

      const question = getQuestion(questionId)
      if (!question) return
      if (question.status === 'answered') return

      const selectedOption = question.options?.find(o => o.id === optionId)
      const userId = 'user' in body ? (body.user as any)?.id : undefined
      const userName = 'user' in body ? (body.user as any)?.name : undefined

      updateQuestionAnswer(questionId, {
        answer: selectedOption?.label || optionId,
        answeredBy: userId || 'unknown',
        answeredByName: userName,
        answerSource: 'button',
        selectedOption: optionId,
      })

      if (question.channelId && question.messageTs) {
        try {
          await client.chat.update({
            channel: question.channelId,
            ts: question.messageTs,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `*${question.question}*` },
              },
              ...(question.context ? [{
                type: 'context' as const,
                elements: [{ type: 'mrkdwn' as const, text: question.context }],
              }] : []),
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `:white_check_mark: *${selectedOption?.label || optionId}* — answered by <@${userId}>`,
                },
              },
            ],
            text: `${question.question} — Answered: ${selectedOption?.label || optionId}`,
          })
        } catch {}
      }

      const updated = getQuestion(questionId)
      if (updated && io) {
        io.emit('slack:question:answered', updated)
      }
      // Button clicks are immediate — trigger refinement directly
      if (updated && internalBus) {
        internalBus.emit('thread:ready', { questionId })
      }
    })

    // "Refine insight" button — user approved refinement
    a.action('refine_insight', async ({ action, body, ack, client }) => {
      await ack()
      if (action.type !== 'button') return
      const questionId = action.value || ''

      // Update the prompt message to show processing
      const msgBody = body as any
      if (msgBody.channel?.id && msgBody.message?.ts) {
        try {
          await client.chat.update({
            channel: msgBody.channel.id,
            ts: msgBody.message.ts,
            text: ':hourglass_flowing_sand: Refining insight with your feedback...',
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: ':hourglass_flowing_sand: Refining insight with your feedback...' },
            }],
          })
        } catch {}
      }

      console.log(`[SlackBot] Refine approved for question ${questionId}`)
      if (internalBus) {
        internalBus.emit('thread:ready', { questionId })
      }
    })

    // "Not now" button — dismiss the refine prompt
    a.action('refine_skip', async ({ action, body, ack, client }) => {
      await ack()
      const msgBody = body as any
      if (msgBody.channel?.id && msgBody.message?.ts) {
        try {
          await client.chat.update({
            channel: msgBody.channel.id,
            ts: msgBody.message.ts,
            text: 'No problem — feedback saved for later.',
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: 'No problem — feedback saved for later.' },
            }],
          })
        } catch {}
      }
    })
  }

  async function postQuestion(questionId: string): Promise<SlackQuestion | null> {
    if (!app) return null
    const question = getQuestion(questionId)
    if (!question) return null

    const targetChannel = question.channelId || channel
    const isCuriosity = question.meta?.source === 'curiosity'

    let result: any

    if (isCuriosity) {
      // Curiosity questions: casual plain text, no blocks
      result = await app.client.chat.postMessage({
        channel: targetChannel,
        text: question.question,
      })
    } else {
      // Standard questions: structured blocks with bold title + options
      const blocks: any[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${question.question}*` },
        },
      ]

      if (question.context) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: question.context }],
        })
      }

      if (question.options && question.options.length > 0) {
        blocks.push({
          type: 'actions',
          block_id: question.id,
          elements: question.options.map((opt: SlackQuestionOption) => ({
            type: 'button',
            text: { type: 'plain_text', text: opt.label },
            action_id: `slack_q_${opt.id}`,
            value: opt.id,
            ...(opt.style ? { style: opt.style } : {}),
          })),
        })
      }

      result = await app.client.chat.postMessage({
        channel: targetChannel,
        blocks,
        text: question.question,
      })
    }

    try {
      if (result.ts) {
        updateQuestionPosted(question.id, targetChannel, result.ts)

        // Curiosity threads are immediately chat-ready
        if (isCuriosity && chatHandler) {
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
