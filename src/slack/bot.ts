import { App } from '@slack/bolt'
import type { Server as SocketIOServer } from 'socket.io'
import { getQuestion, updateQuestionPosted, updateQuestionAnswer, findQuestionByThread } from '../db/slack'
import type { SlackQuestion, SlackQuestionOption } from '../types'

export type SlackBotOptions = {
  botToken: string
  appToken: string
  channel: string
  io?: SocketIOServer
}

export type SlackBot = {
  start: () => Promise<void>
  stop: () => Promise<void>
  postQuestion: (questionId: string) => Promise<SlackQuestion | null>
  isConnected: () => boolean
  testConnection: () => Promise<{ ok: boolean; team?: string; user?: string; error?: string }>
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
  const { botToken, appToken, channel, io } = options
  let connected = false
  let app: App | null = null

  function setupListeners(a: App) {
    // Catch async errors from Socket Mode / Web API
    a.error(async (error) => {
      console.error('[SlackBot] Error:', error.message || error)
      connected = false
      if (io) io.emit('slack:status', { connected: false })
    })

    // Thread reply listener — matches replies to question threads
    a.message(async ({ message, client }) => {
      if (!('thread_ts' in message) || !message.thread_ts) return
      if (!('channel' in message) || !message.channel) return
      if ('bot_id' in message && message.bot_id) return
      if (!('text' in message) || !message.text) return

      const question = findQuestionByThread(message.channel, message.thread_ts)
      if (!question) return
      if (question.status === 'answered') return

      let userName: string | undefined
      if ('user' in message && message.user) {
        try {
          const userInfo = await client.users.info({ user: message.user })
          userName = userInfo.user?.real_name || userInfo.user?.name
        } catch {}
      }

      updateQuestionAnswer(question.id, {
        answer: message.text,
        answeredBy: ('user' in message ? message.user : undefined) || 'unknown',
        answeredByName: userName,
        answerSource: 'thread',
        threadTs: ('ts' in message ? message.ts : undefined) as string | undefined,
      })

      const updated = getQuestion(question.id)
      if (updated && io) {
        io.emit('slack:question:answered', updated)
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
    })
  }

  async function postQuestion(questionId: string): Promise<SlackQuestion | null> {
    if (!app) return null
    const question = getQuestion(questionId)
    if (!question) return null

    const targetChannel = question.channelId || channel

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

    try {
      const result = await app.client.chat.postMessage({
        channel: targetChannel,
        blocks,
        text: question.question,
      })

      if (result.ts) {
        updateQuestionPosted(question.id, targetChannel, result.ts)
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
      if (app) await app.stop()
      app = null
    },
    postQuestion,
    isConnected: () => connected,
    testConnection,
  }
}
