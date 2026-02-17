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

export function createSlackBot(options: SlackBotOptions): SlackBot {
  const { botToken, appToken, channel, io } = options
  let connected = false

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  })

  // Catch async errors from Socket Mode / Web API to prevent process crash
  app.error(async (error) => {
    console.error('[SlackBot] Error:', error.message || error)
    connected = false
    if (io) io.emit('slack:status', { connected: false })
  })

  // Thread reply listener — matches replies to question threads
  app.message(async ({ message, client }) => {
    // Only handle threaded replies (messages with thread_ts)
    if (!('thread_ts' in message) || !message.thread_ts) return
    if (!('channel' in message) || !message.channel) return
    // Ignore bot messages
    if ('bot_id' in message && message.bot_id) return
    if (!('text' in message) || !message.text) return

    const question = findQuestionByThread(message.channel, message.thread_ts)
    if (!question) return
    if (question.status === 'answered') return

    // Get user info
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
  app.action(/^slack_q_/, async ({ action, body, ack, client }) => {
    await ack()

    if (action.type !== 'button') return
    // action_id format: slack_q_{questionId}_{optionId}
    const parts = action.action_id.split('_')
    // Find questionId — it's between "slack_q_" prefix and the last segment (optionId)
    // Since questionId is a UUID, reconstruct it
    const actionId = action.action_id
    const prefix = 'slack_q_'
    const withoutPrefix = actionId.slice(prefix.length)
    // The option ID is the value
    const optionId = action.value || ''

    // block_id is the question ID
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

    // Update the Slack message to show result
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

  async function postQuestion(questionId: string): Promise<SlackQuestion | null> {
    const question = getQuestion(questionId)
    if (!question) return null

    const targetChannel = question.channelId || channel

    // Build Block Kit message
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
    try {
      const result = await app.client.auth.test()
      return {
        ok: result.ok || false,
        team: result.team as string | undefined,
        user: result.user as string | undefined,
      }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Connection failed' }
    }
  }

  return {
    start: async () => {
      // Validate tokens before attempting connection
      const authTest = await app.client.auth.test().catch((err: any) => {
        throw new Error(`Slack auth failed: ${err.data?.error || err.message}`)
      })
      if (!authTest.ok) throw new Error('Slack auth.test returned not ok')

      await app.start()
      connected = true
      if (io) io.emit('slack:status', { connected: true })
      console.log('Slack bot connected (Socket Mode)')
    },
    stop: async () => {
      connected = false
      if (io) io.emit('slack:status', { connected: false })
      await app.stop()
    },
    postQuestion,
    isConnected: () => connected,
    testConnection,
  }
}
