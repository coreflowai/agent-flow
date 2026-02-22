import { getQuestion, listQuestions, updateQuestionMeta } from '../db/slack'
import type { ThreadReply } from '../db/slack'
import type { SlackQuestion } from '../types'

// --- Types ---

export type EngagementSignals = {
  replyCount: number
  uniqueResponders: number
  avgReplyLength: number
  responseTimeSec: number | null
  targetUserReplied: boolean
}

export type QuestionScore = {
  value: number          // 0-1 normalized
  signals: EngagementSignals
  strategy: string       // e.g. "heuristic-v1"
  scoredAt: number
}

export interface QuestionScorer {
  readonly name: string
  score(signals: EngagementSignals): Promise<number>
}

// --- Heuristic Scorer (v1) ---

const WEIGHTS = {
  replyCount: 0.30,
  uniqueResponders: 0.25,
  avgReplyLength: 0.20,
  responseTime: 0.15,
  targetUserReplied: 0.10,
}

class HeuristicScorer implements QuestionScorer {
  readonly name = 'heuristic-v1'

  async score(signals: EngagementSignals): Promise<number> {
    const replyScore = Math.min(signals.replyCount / 3, 1)
    const responderScore = Math.min(signals.uniqueResponders / 2, 1)
    const lengthScore = Math.min(signals.avgReplyLength / 200, 1)

    let timeScore = 0
    if (signals.responseTimeSec !== null) {
      // < 5 min = 1.0, linear decay to 0 at 60 min
      const fiveMin = 5 * 60
      const sixtyMin = 60 * 60
      if (signals.responseTimeSec <= fiveMin) {
        timeScore = 1
      } else if (signals.responseTimeSec >= sixtyMin) {
        timeScore = 0
      } else {
        timeScore = 1 - (signals.responseTimeSec - fiveMin) / (sixtyMin - fiveMin)
      }
    }

    const targetScore = signals.targetUserReplied ? 1 : 0

    return (
      WEIGHTS.replyCount * replyScore +
      WEIGHTS.uniqueResponders * responderScore +
      WEIGHTS.avgReplyLength * lengthScore +
      WEIGHTS.responseTime * timeScore +
      WEIGHTS.targetUserReplied * targetScore
    )
  }
}

// --- Scorer registry ---

let currentScorer: QuestionScorer = new HeuristicScorer()

export function setScorer(scorer: QuestionScorer): void {
  currentScorer = scorer
}

export function getScorer(): QuestionScorer {
  return currentScorer
}

// --- Core functions ---

export function extractEngagementSignals(question: SlackQuestion): EngagementSignals {
  const meta = (question.meta ?? {}) as Record<string, unknown>
  const replies = (meta.threadReplies ?? []) as ThreadReply[]
  const targetUser = meta.targetUser as string | undefined

  const replyCount = replies.length
  const uniqueResponders = new Set(replies.map(r => r.userId)).size
  const avgReplyLength = replyCount > 0
    ? replies.reduce((sum, r) => sum + r.text.length, 0) / replyCount
    : 0

  let responseTimeSec: number | null = null
  if (replies.length > 0 && question.createdAt) {
    const firstReplyTime = replies[0].receivedAt
    responseTimeSec = (firstReplyTime - question.createdAt) / 1000
    if (responseTimeSec < 0) responseTimeSec = 0
  }

  const targetUserReplied = targetUser
    ? replies.some(r =>
        r.userId === targetUser ||
        r.userName?.toLowerCase() === targetUser.toLowerCase()
      )
    : false

  return {
    replyCount,
    uniqueResponders,
    avgReplyLength,
    responseTimeSec,
    targetUserReplied,
  }
}

export async function scoreQuestion(questionId: string): Promise<QuestionScore | null> {
  const question = getQuestion(questionId)
  if (!question) return null

  const signals = extractEngagementSignals(question)
  const value = await currentScorer.score(signals)

  const score: QuestionScore = {
    value: Math.round(value * 100) / 100,
    signals,
    strategy: currentScorer.name,
    scoredAt: Date.now(),
  }

  updateQuestionMeta(questionId, { score })
  return score
}

const UNANSWERED_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours

export async function scoreUnansweredQuestions(): Promise<number> {
  const posted = listQuestions({ status: 'posted', limit: 100 })
  const now = Date.now()
  let scored = 0

  for (const q of posted) {
    if ((q.meta as any)?.source !== 'curiosity') continue
    if ((q.meta as any)?.score) continue // already scored
    if (now - q.createdAt < UNANSWERED_THRESHOLD_MS) continue

    const score: QuestionScore = {
      value: 0,
      signals: extractEngagementSignals(q),
      strategy: currentScorer.name,
      scoredAt: now,
    }
    updateQuestionMeta(q.id, { score })
    scored++
  }

  if (scored > 0) {
    console.log(`[Scoring] Scored ${scored} unanswered curiosity questions as 0`)
  }
  return scored
}

export function buildFeedbackSection(): string {
  // Get recent curiosity questions that have been scored
  const recent = listQuestions({ limit: 50 })
  const scored: { question: string; score: QuestionScore; replyCount: number; responders: number }[] = []

  for (const q of recent) {
    const meta = q.meta as Record<string, unknown>
    if (meta?.source !== 'curiosity') continue
    const s = meta?.score as QuestionScore | undefined
    if (!s) continue
    scored.push({
      question: q.question,
      score: s,
      replyCount: s.signals.replyCount,
      responders: s.signals.uniqueResponders,
    })
  }

  if (scored.length < 3) return ''

  scored.sort((a, b) => b.score.value - a.score.value)

  const top5 = scored.slice(0, 5)
  const bottom5 = scored.filter(s => s.score.value < 0.3).slice(-5)

  let section = `## Question Engagement Feedback

### High-engagement questions (aim for more like these):
${top5.map(s =>
    `- [score: ${s.score.value.toFixed(2)}] "${s.question}" (${s.replyCount} replies from ${s.responders} people)`
  ).join('\n')}
`

  if (bottom5.length > 0) {
    section += `
### Low-engagement questions (avoid these patterns):
${bottom5.map(s =>
      `- [score: ${s.score.value.toFixed(2)}] "${s.question}" (${s.replyCount === 0 ? 'no replies' : `${s.replyCount} replies`})`
    ).join('\n')}
`
  }

  return section
}
