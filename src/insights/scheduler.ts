import { Cron } from 'croner'
import { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { runAnalysis } from './analyzer'
import {
  getUsersWithActivity,
  getAnalysisState,
  updateAnalysisState,
  addInsight,
  countUserSessionsSince,
} from '../db/insights'
import type { SlackBot } from '../slack'

// Minimum sessions required to trigger analysis
const MIN_SESSIONS_FOR_ANALYSIS = 10

// Default analysis window: 30 minutes
const DEFAULT_ANALYSIS_WINDOW_MS = 30 * 60 * 1000


export type InsightSchedulerOptions = {
  /** Socket.IO server for real-time updates */
  io: SocketIOServer
  /** Path to the SQLite database */
  dbPath: string
  /** Path to the sources SQLite database (for external context) */
  sourcesDbPath?: string
  /** Cron expression (default: every 5 hours) */
  cronExpression?: string
  /** Whether to run immediately on start */
  runOnStart?: boolean
  /** Minimum sessions required to trigger analysis */
  minSessionsForAnalysis?: number
  /** Reference to Slack bot for posting questions */
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> }
  /** Internal event bus for cross-component communication */
  internalBus?: EventEmitter
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
    sourcesDbPath,
    cronExpression = '0 * * * *', // Every hour
    runOnStart = false,
    minSessionsForAnalysis = MIN_SESSIONS_FOR_ANALYSIS,
    slackBot,
    internalBus,
  } = options

  let isAnalyzing = false

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
          await analyzeUser(user.userId, minSessionsForAnalysis, dbPath, io, slackBot, sourcesDbPath)
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
 * Analyze all recent sessions for a single user (across all repos).
 * Generates insights stored in DB — no Slack questions (curiosity bot handles Q&A).
 */
async function analyzeUser(
  userId: string,
  minSessions: number,
  dbPath: string,
  io: SocketIOServer,
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> },
  sourcesDbPath?: string,
) {
  console.log(`[InsightScheduler] Analyzing user: ${userId}`)

  // Get the last analysis state for this user (repoName = null means all repos)
  const state = getAnalysisState(userId, null)
  const sinceTimestamp = state?.lastEventTimestamp ?? 0

  // Count new sessions since last analysis
  const newSessionCount = countUserSessionsSince(userId, sinceTimestamp)

  if (newSessionCount < minSessions) {
    console.log(`[InsightScheduler] Skipping ${userId}: only ${newSessionCount} new sessions (need ${minSessions})`)
    return
  }

  console.log(`[InsightScheduler] Running analysis for ${userId} with ${newSessionCount} new sessions`)

  // Run the analysis (repoName = null to analyze all repos)
  const analysisWindowStart = sinceTimestamp || Date.now() - DEFAULT_ANALYSIS_WINDOW_MS
  const analysisWindowEnd = Date.now()

  const result = await runAnalysis(userId, null, sinceTimestamp, dbPath, sourcesDbPath)

  if (!result.success) {
    console.error(`[InsightScheduler] Analysis failed for ${userId}:`, result.error)
    io.emit('insight:error', { userId, error: result.error, timestamp: Date.now() })
    if (slackBot?.bot?.isConnected()) {
      await slackBot.bot.sendAdminDM(`⚠️ Insight analysis failed for *${userId}*:\n>${result.error}`)
    }
    return
  }

  // Save the insight — questions are NOT posted to Slack (curiosity bot handles Q&A)
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
    meta: result.meta,
  })

  console.log(`[InsightScheduler] Created insight ${insight.id} for ${userId}`)

  // Update analysis state
  updateAnalysisState(userId, null, analysisWindowEnd)

  // Emit real-time update via Socket.IO
  io.emit('insight:new', insight)
}

