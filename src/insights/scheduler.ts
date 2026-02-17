import { Cron } from 'croner'
import { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { runAnalysis, runRefinement } from './analyzer'
import {
  getUsersWithActivity,
  getAnalysisState,
  updateAnalysisState,
  addInsight,
  updateInsight,
  getInsight,
  countUserEventsSince,
} from '../db/insights'
import { addQuestion, getQuestionsByInsightId } from '../db/slack'
import type { SlackBot } from '../slack'
import type { InsightMeta } from '../types'

// Minimum events required to trigger analysis
const MIN_EVENTS_FOR_ANALYSIS = 5

// Default analysis window: 30 minutes
const DEFAULT_ANALYSIS_WINDOW_MS = 30 * 60 * 1000

// Default question timeout: 10 minutes
const DEFAULT_QUESTION_TIMEOUT_MS = 10 * 60 * 1000

// Default max question rounds
const DEFAULT_MAX_QUESTION_ROUNDS = 3

export type InsightSchedulerOptions = {
  /** Socket.IO server for real-time updates */
  io: SocketIOServer
  /** Path to the SQLite database */
  dbPath: string
  /** Cron expression (default: every 5 hours) */
  cronExpression?: string
  /** Whether to run immediately on start */
  runOnStart?: boolean
  /** Minimum events required to trigger analysis */
  minEventsForAnalysis?: number
  /** Reference to Slack bot for posting questions */
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> }
  /** Internal event bus for cross-component communication */
  internalBus?: EventEmitter
  /** Timeout for waiting on question answers (ms) */
  questionTimeoutMs?: number
  /** Max rounds of questions before forcing final */
  maxQuestionRounds?: number
}

export type InsightScheduler = {
  /** Stop the scheduler */
  stop: () => void
  /** Run analysis manually */
  runNow: () => Promise<void>
  /** Check if scheduler is running */
  isRunning: () => boolean
}

/**
 * Create and start the insight analysis scheduler.
 * Runs every 5 hours by default, analyzing all sessions per user.
 */
export function createInsightScheduler(options: InsightSchedulerOptions): InsightScheduler {
  const {
    io,
    dbPath,
    cronExpression = '0 */5 * * *', // Every 5 hours
    runOnStart = false,
    minEventsForAnalysis = MIN_EVENTS_FOR_ANALYSIS,
    slackBot,
    internalBus,
    questionTimeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
    maxQuestionRounds = DEFAULT_MAX_QUESTION_ROUNDS,
  } = options

  let isAnalyzing = false

  // Listen for late answers on the internal bus
  if (internalBus) {
    internalBus.on('question:answered', async (question) => {
      if (!question.insightId) return

      try {
        const insight = getInsight(question.insightId)
        if (!insight) return

        const phase = insight.meta?.phase
        // Only re-analyze if the insight was finalized without answers or was preliminary
        if (phase !== 'final-no-answers' && phase !== 'preliminary') return

        console.log(`[InsightScheduler] Late answer received for insight ${insight.id}, triggering re-analysis`)
        await handleLateAnswer(insight.id, insight.userId, insight.content, dbPath, io)
      } catch (err) {
        console.error('[InsightScheduler] Error handling late answer:', err)
      }
    })
  }

  async function runAnalysisJob() {
    if (isAnalyzing) {
      console.log('[InsightScheduler] Analysis already in progress, skipping')
      return
    }

    isAnalyzing = true
    console.log('[InsightScheduler] Starting analysis run at', new Date().toISOString())

    try {
      // Get all users that have had activity
      const users = getUsersWithActivity()
      console.log(`[InsightScheduler] Found ${users.length} users with activity`)

      for (const user of users) {
        try {
          await analyzeUser(user.userId, minEventsForAnalysis, dbPath, io, slackBot, questionTimeoutMs, maxQuestionRounds)
        } catch (error) {
          console.error(`[InsightScheduler] Error analyzing ${user.userId}:`, error)
        }
      }

      console.log('[InsightScheduler] Analysis run completed')
    } catch (error) {
      console.error('[InsightScheduler] Error during analysis run:', error)
    } finally {
      isAnalyzing = false
    }
  }

  // Create the cron job
  const job = new Cron(cronExpression, {
    name: 'insight-analysis',
    protect: true, // Prevent overlapping runs
  }, runAnalysisJob)

  console.log(`[InsightScheduler] Scheduled with cron: ${cronExpression}`)

  // Run immediately if requested
  if (runOnStart) {
    console.log('[InsightScheduler] Running initial analysis...')
    runAnalysisJob()
  }

  return {
    stop: () => {
      job.stop()
      console.log('[InsightScheduler] Stopped')
    },
    runNow: runAnalysisJob,
    isRunning: () => job.isRunning(),
  }
}

/**
 * Wait for all questions to be answered, polling every 5 seconds.
 * Returns once all are answered or timeout expires.
 */
async function waitForAllAnswers(
  questionIds: string[],
  timeoutMs: number,
  insightId: string,
): Promise<{ answered: boolean; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs
  const pollInterval = 5000

  while (Date.now() < deadline) {
    const questions = getQuestionsByInsightId(insightId)
    const relevantQuestions = questions.filter(q => questionIds.includes(q.id))
    const allAnswered = relevantQuestions.every(q => q.status === 'answered')

    if (allAnswered && relevantQuestions.length === questionIds.length) {
      return { answered: true, timedOut: false }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  return { answered: false, timedOut: true }
}

/**
 * Analyze all recent sessions for a single user (across all repos).
 * Supports a conversational loop: ask questions → wait → refine → maybe ask again.
 */
async function analyzeUser(
  userId: string,
  minEvents: number,
  dbPath: string,
  io: SocketIOServer,
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> },
  questionTimeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
  maxQuestionRounds = DEFAULT_MAX_QUESTION_ROUNDS,
) {
  console.log(`[InsightScheduler] Analyzing user: ${userId}`)

  // Get the last analysis state for this user (repoName = null means all repos)
  const state = getAnalysisState(userId, null)
  const sinceTimestamp = state?.lastEventTimestamp ?? 0

  // Count new events since last analysis (across all repos)
  const newEventCount = countUserEventsSince(userId, sinceTimestamp)

  if (newEventCount < minEvents) {
    console.log(`[InsightScheduler] Skipping ${userId}: only ${newEventCount} new events (need ${minEvents})`)
    return
  }

  console.log(`[InsightScheduler] Running analysis for ${userId} with ${newEventCount} new events`)

  // Run the analysis (repoName = null to analyze all repos)
  const analysisWindowStart = sinceTimestamp || Date.now() - DEFAULT_ANALYSIS_WINDOW_MS
  const analysisWindowEnd = Date.now()

  const result = await runAnalysis(userId, null, sinceTimestamp, dbPath)

  if (!result.success) {
    console.error(`[InsightScheduler] Analysis failed for ${userId}:`, result.error)
    io.emit('insight:error', { userId, error: result.error, timestamp: Date.now() })
    if (slackBot?.bot?.isConnected()) {
      await slackBot.bot.postNotification(`⚠️ Insight analysis failed for *${userId}*:\n>${result.error}`)
    }
    return
  }

  const hasQuestions = result.questions && result.questions.length > 0
  const canAskQuestions = hasQuestions && slackBot?.bot?.isConnected()

  // Save the initial insight
  const meta: InsightMeta = {
    ...result.meta,
    phase: canAskQuestions ? 'preliminary' : (hasQuestions ? 'final-no-answers' : undefined),
    questionCount: result.questions?.length ?? 0,
    answersReceived: 0,
  }

  const insight = addInsight({
    userId,
    repoName: null,
    content: result.content,
    categories: result.categories,
    followUpActions: result.followUpActions,
    sessionsAnalyzed: result.sessionsAnalyzed,
    eventsAnalyzed: result.eventsAnalyzed,
    analysisWindowStart,
    analysisWindowEnd,
    meta,
  })

  console.log(`[InsightScheduler] Created insight ${insight.id} for ${userId}`)

  // Update analysis state
  updateAnalysisState(userId, null, analysisWindowEnd)

  // Emit real-time update via Socket.IO
  io.emit('insight:new', insight)

  // If no questions or no Slack bot, we're done
  if (!canAskQuestions || !result.questions) {
    if (hasQuestions) {
      console.log(`[InsightScheduler] AI had ${result.questions!.length} questions but Slack not connected — saving as final-no-answers`)
    }
    return
  }

  // Conversational loop: post questions, wait for answers, refine
  let currentContent = result.content
  let currentQuestions = result.questions
  let totalQuestionsAsked = 0
  let totalAnswersReceived = 0

  for (let round = 0; round < maxQuestionRounds; round++) {
    if (!currentQuestions || currentQuestions.length === 0) break

    console.log(`[InsightScheduler] Round ${round + 1}: posting ${currentQuestions.length} questions for ${userId}`)

    // Post questions to Slack
    const questionIds: string[] = []
    for (const q of currentQuestions) {
      const dbQuestion = addQuestion({
        question: q.text,
        context: q.reason,
        insightId: insight.id,
        options: q.options?.map(o => ({ id: o.id, label: o.label })),
        expiresAt: Date.now() + questionTimeoutMs,
        meta: { targetUser: q.targetUser, round: round + 1 },
      })
      questionIds.push(dbQuestion.id)
      totalQuestionsAsked++

      // Post to Slack
      await slackBot!.bot!.postQuestion(dbQuestion.id)
    }

    // Wait for answers
    console.log(`[InsightScheduler] Waiting up to ${questionTimeoutMs / 1000}s for answers...`)
    const waitResult = await waitForAllAnswers(questionIds, questionTimeoutMs, insight.id)

    // Gather whatever answers we got
    const answeredQuestions = getQuestionsByInsightId(insight.id)
      .filter(q => q.status === 'answered')
    totalAnswersReceived = answeredQuestions.length

    if (answeredQuestions.length === 0) {
      // No answers at all — mark as final-no-answers so late answers trigger re-analysis
      console.log(`[InsightScheduler] No answers received for ${userId} in round ${round + 1}`)
      updateInsight(insight.id, {
        meta: { ...meta, phase: 'final-no-answers', questionCount: totalQuestionsAsked, answersReceived: 0 },
      })
      io.emit('insight:updated', getInsight(insight.id))
      return
    }

    // Run refinement with all answers collected so far
    console.log(`[InsightScheduler] Refining insight with ${answeredQuestions.length} answers for ${userId}`)
    const answers = answeredQuestions.map(q => ({
      question: q.question,
      answer: q.answer || '',
      answeredBy: q.answeredByName || q.answeredBy || 'unknown',
    }))

    const refinedResult = await runRefinement({
      userId,
      originalContent: currentContent,
      answers,
      dbPath,
    })

    if (!refinedResult.success) {
      console.error(`[InsightScheduler] Refinement failed for ${userId}:`, refinedResult.error)
      io.emit('insight:error', { userId, error: refinedResult.error, timestamp: Date.now() })
      if (slackBot?.bot?.isConnected()) {
        await slackBot.bot.postNotification(`⚠️ Insight refinement failed for *${userId}*:\n>${refinedResult.error}`)
      }
      break
    }

    // Update the insight with refined content
    const isLastRound = round + 1 >= maxQuestionRounds
    const hasFollowUps = refinedResult.questions && refinedResult.questions.length > 0

    const refinedPhase = (hasFollowUps && !isLastRound) ? 'preliminary' as const : 'refined' as const

    updateInsight(insight.id, {
      content: refinedResult.content,
      categories: refinedResult.categories,
      followUpActions: refinedResult.followUpActions,
      meta: {
        ...refinedResult.meta,
        phase: refinedPhase,
        questionCount: totalQuestionsAsked,
        answersReceived: totalAnswersReceived,
      },
    })

    io.emit('insight:updated', getInsight(insight.id))
    console.log(`[InsightScheduler] Updated insight ${insight.id} — phase: ${refinedPhase}`)

    // Set up for next round
    currentContent = refinedResult.content
    currentQuestions = refinedResult.questions || []

    // If no follow-up questions or last round, we're done
    if (!hasFollowUps || isLastRound) break
  }
}

/**
 * Handle a late answer by re-analyzing the insight with all collected answers.
 */
async function handleLateAnswer(
  insightId: string,
  userId: string,
  currentContent: string,
  dbPath: string,
  io: SocketIOServer,
) {
  const answeredQuestions = getQuestionsByInsightId(insightId)
    .filter(q => q.status === 'answered')

  if (answeredQuestions.length === 0) return

  const answers = answeredQuestions.map(q => ({
    question: q.question,
    answer: q.answer || '',
    answeredBy: q.answeredByName || q.answeredBy || 'unknown',
  }))

  const refinedResult = await runRefinement({
    userId,
    originalContent: currentContent,
    answers,
    dbPath,
  })

  if (!refinedResult.success) {
    console.error(`[InsightScheduler] Late refinement failed for ${userId}:`, refinedResult.error)
    io.emit('insight:error', { userId, error: refinedResult.error, timestamp: Date.now() })
    return
  }

  updateInsight(insightId, {
    content: refinedResult.content,
    categories: refinedResult.categories,
    followUpActions: refinedResult.followUpActions,
    meta: {
      ...refinedResult.meta,
      phase: 'refined-late',
      answersReceived: answeredQuestions.length,
    },
  })

  const updated = getInsight(insightId)
  io.emit('insight:updated', updated)
  console.log(`[InsightScheduler] Late-refined insight ${insightId} with ${answeredQuestions.length} answers`)
}
