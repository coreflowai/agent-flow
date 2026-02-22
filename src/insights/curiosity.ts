import Anthropic from '@anthropic-ai/sdk'
import { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { tools, executeSqlTool, executeSchemaTools, executeSemanticSearchTool, buildTeamContext } from './analyzer'
import { addQuestion, getQuestion, markQuestionAnsweredFromReplies } from '../db/slack'
import { scoreQuestion, scoreUnansweredQuestions, buildFeedbackSection } from './scoring'
import { addDataSource, listDataSources, addSourceEntry } from '../db/sources'
import type { SlackBot } from '../slack'
import type { DataSource } from '../types'

const AGENT_SOURCE_NAME = 'Agent Questions'

export type CuriositySchedulerOptions = {
  io: SocketIOServer
  dbPath: string
  sourcesDbPath?: string
  slackBot: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> }
  internalBus: EventEmitter
  workingHours?: { start: number; end: number }
  timezone?: string
  /** Base interval in minutes (default: 60) */
  baseIntervalMinutes?: number
  /** Probability of firing each eligible tick (default: 0.3) */
  fireProbability?: number
}

export type CuriosityScheduler = {
  stop: () => void
  isRunning: () => boolean
}

/**
 * Find or create the "Agent Questions" data source.
 * Returns the data source ID.
 */
export function ensureAgentDataSource(dbPath: string): string {
  const existing = listDataSources().find(
    ds => ds.name === AGENT_SOURCE_NAME && ds.type === 'agent'
  )
  if (existing) return existing.id

  const ds = addDataSource({
    name: AGENT_SOURCE_NAME,
    type: 'agent',
    config: {} as any,
  })
  console.log(`[Curiosity] Created "Agent Questions" data source: ${ds.id}`)
  return ds.id
}

/**
 * Build the curiosity prompt for the AI.
 */
function buildCuriosityPrompt(agentDataSourceId: string, teamContext: string): string {
  const feedbackSection = buildFeedbackSection()

  return `You are a curious team assistant embedded in an AI agent observability platform. Your job is to learn about the team's work by asking interesting, specific questions.

## Your Task

Use the \`sql\` tool to look at recent sessions, events, and past Q&A. Then generate ONE question to ask the team.

First use the \`schema\` tool to understand the database, then explore.

## What to Look For

- What projects or repos are people working on? Anything new or unusual?
- Are there patterns in tool usage, errors, or workflows that are interesting?
- What time of day do people work? Any shifts in activity?
- Are there recurring frustrations or blockers?
- Any cross-team patterns (multiple users hitting the same issue)?
- New tools or approaches being adopted?

## Past Q&A

Check what you've already asked so you don't repeat yourself. Use the \`semantic_search\` tool
to find similar past questions before generating a new one. Also query recent Q&A via SQL:

\`\`\`sql
SELECT se.content, se.timestamp
FROM src.source_entries se
WHERE se.data_source_id = '${agentDataSourceId}'
ORDER BY se.timestamp DESC
LIMIT 20;
\`\`\`

After drafting your question idea, use \`semantic_search\` with your candidate question to check
if something similar was already asked. If it was, pick a different angle.

## Guidelines

- Ask like a curious colleague — casual, specific, one question only
- Don't ask generic questions like "how's the project going?"
- Ground your question in something specific you observed in the data
- If a question is about a specific person's work, target them
- Don't repeat questions you've already asked (check past Q&A above)

${teamContext}

${feedbackSection}
## Output Format

Respond with valid JSON:

\`\`\`json
{
  "question": "Your one specific question",
  "context": "Brief note on why you're asking (what you saw in the data)",
  "targetUser": "username_or_null"
}
\`\`\`
`
}

type CuriosityOutput = {
  question: string
  context: string
  targetUser?: string | null
}

/**
 * Run the curiosity prompt — agentic loop with sql/schema tools.
 */
async function runCuriosityPrompt(opts: {
  dbPath: string
  sourcesDbPath?: string
  agentDataSourceId: string
}): Promise<CuriosityOutput | null> {
  const { dbPath, sourcesDbPath, agentDataSourceId } = opts

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[Curiosity] ANTHROPIC_API_KEY not set')
    return null
  }

  const teamContext = buildTeamContext(dbPath)
  const prompt = buildCuriosityPrompt(agentDataSourceId, teamContext)

  const client = new Anthropic({ apiKey })
  const model = 'claude-sonnet-4-6'

  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ]

  let totalInputTokens = 0
  let totalOutputTokens = 0

  const maxIterations = 10
  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      tools,
      messages,
    })

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    if (response.stop_reason === 'end_turn') {
      const textContent = response.content.find(c => c.type === 'text')
      const content = textContent?.type === 'text' ? textContent.text : ''
      const output = extractCuriosityOutput(content)
      if (output) {
        console.log(`[Curiosity] Generated question (${totalInputTokens}/${totalOutputTokens} tokens): ${output.question}`)
      }
      return output
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(c => c.type === 'tool_use')
      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue
        let result: string
        try {
          if (block.name === 'sql') {
            result = executeSqlTool((block.input as { query: string }).query, dbPath, sourcesDbPath)
          } else if (block.name === 'schema') {
            result = executeSchemaTools()
          } else if (block.name === 'semantic_search') {
            const input = block.input as { query: string; topk?: number; dataSourceId?: string }
            result = await executeSemanticSearchTool(input.query, input.topk, input.dataSourceId)
          } else {
            result = `Unknown tool: ${block.name}`
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }
      messages.push({ role: 'user', content: toolResults })
    }
  }

  console.error('[Curiosity] Max iterations reached')
  return null
}

/**
 * Extract the curiosity JSON output from the LLM response.
 */
function extractCuriosityOutput(content: string): CuriosityOutput | null {
  if (!content) return null

  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1])
      if (parsed.question) return parsed
    } catch {}
  }

  const jsonMatch = content.match(/\{[\s\S]*"question"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.question) return parsed
    } catch {}
  }

  return null
}

/**
 * Check if the current time is within working hours.
 */
function isWorkingHours(hours: { start: number; end: number }, timezone: string): boolean {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  })
  const currentHour = parseInt(formatter.format(now), 10)
  return currentHour >= hours.start && currentHour < hours.end
}

/**
 * Create and start the curiosity scheduler.
 * Fires on a jittered interval during working hours with a random chance of asking a question.
 */
export function createCuriosityScheduler(options: CuriositySchedulerOptions): CuriosityScheduler {
  const {
    io,
    dbPath,
    sourcesDbPath,
    slackBot,
    internalBus,
    workingHours = { start: 9, end: 18 },
    timezone = process.env.TZ || 'America/Los_Angeles',
    baseIntervalMinutes = 60,
    fireProbability = 0.3,
  } = options

  let running = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let isAsking = false

  // Ensure the agent data source exists
  const agentDataSourceId = ensureAgentDataSource(dbPath)

  // Listen for thread:ready — store answered curiosity questions as source entries
  internalBus.on('thread:ready', async ({ questionId }: { questionId: string }) => {
    try {
      markQuestionAnsweredFromReplies(questionId)
      const question = getQuestion(questionId)
      if (!question) return

      // Only handle curiosity questions
      if (question.meta?.source !== 'curiosity') return

      if (question.status !== 'answered' || !question.answer) return

      addSourceEntry({
        dataSourceId: agentDataSourceId,
        externalId: `curiosity:${questionId}`,
        author: 'AgentFlow',
        content: `Q: ${question.question}\nA: ${question.answer}`,
        url: null,
        timestamp: Date.now(),
        meta: {
          questionId,
          answeredBy: question.answeredByName || question.answeredBy,
          question: question.question,
          answer: question.answer,
        },
      })

      // Score the question based on engagement
      const score = await scoreQuestion(questionId)
      if (score) {
        console.log(`[Curiosity] Scored question ${questionId}: ${score.value}`)
      }

      console.log(`[Curiosity] Stored Q&A for question ${questionId}`)
    } catch (err) {
      console.error('[Curiosity] Error handling thread:ready:', err)
    }
  })

  async function tick() {
    if (!running) return

    // Skip if outside working hours
    if (!isWorkingHours(workingHours, timezone)) {
      scheduleNext()
      return
    }

    // Random chance of firing
    if (Math.random() > fireProbability) {
      scheduleNext()
      return
    }

    // Skip if no Slack bot
    if (!slackBot?.bot?.isConnected()) {
      scheduleNext()
      return
    }

    if (isAsking) {
      scheduleNext()
      return
    }

    isAsking = true
    try {
      // Score any unanswered questions older than 4h before generating new ones
      await scoreUnansweredQuestions()

      console.log('[Curiosity] Running curiosity prompt...')
      const output = await runCuriosityPrompt({ dbPath, sourcesDbPath, agentDataSourceId })

      if (!output) {
        console.log('[Curiosity] No question generated')
        return
      }

      // Post question via existing Slack question infrastructure
      const dbQuestion = addQuestion({
        question: output.question,
        context: output.context,
        meta: {
          source: 'curiosity',
          targetUser: output.targetUser,
        },
      })

      await slackBot.bot!.postQuestion(dbQuestion.id)
      console.log(`[Curiosity] Posted question: ${output.question}`)
    } catch (err) {
      console.error('[Curiosity] Error during curiosity run:', err)
    } finally {
      isAsking = false
      scheduleNext()
    }
  }

  function scheduleNext() {
    if (!running) return
    // Jitter: 0.75x to 1.5x base interval
    const jitter = 0.75 + Math.random() * 0.75
    const intervalMs = baseIntervalMinutes * 60 * 1000 * jitter
    timer = setTimeout(tick, intervalMs)
  }

  // Start the first tick after a short delay
  timer = setTimeout(tick, 30_000)
  console.log(`[Curiosity] Scheduler started (interval: ~${baseIntervalMinutes}min, hours: ${workingHours.start}-${workingHours.end} ${timezone})`)

  return {
    stop: () => {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      console.log('[Curiosity] Scheduler stopped')
    },
    isRunning: () => running,
  }
}
