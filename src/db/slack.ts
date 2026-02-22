import { eq, desc, and } from 'drizzle-orm'
import { getDb } from './index'
import { slackQuestions, integrationConfigs } from './schema'
import type { SlackQuestion, CreateSlackQuestionInput, SlackQuestionOption } from '../types'

// --- Slack Questions ---

function rowToQuestion(row: any): SlackQuestion {
  return {
    id: row.id,
    question: row.question,
    context: row.context,
    status: row.status as SlackQuestion['status'],
    channelId: row.channelId,
    messageTs: row.messageTs,
    threadTs: row.threadTs,
    answer: row.answer,
    answeredBy: row.answeredBy,
    answeredByName: row.answeredByName,
    answeredAt: row.answeredAt,
    answerSource: row.answerSource as SlackQuestion['answerSource'],
    options: (row.options ?? null) as SlackQuestionOption[] | null,
    selectedOption: row.selectedOption,
    insightId: row.insightId,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  }
}

export function addQuestion(input: CreateSlackQuestionInput): SlackQuestion {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = Date.now()

  db.insert(slackQuestions).values({
    id,
    question: input.question,
    context: input.context ?? null,
    status: 'pending',
    channelId: input.channelId ?? null,
    options: input.options ?? null,
    insightId: input.insightId ?? null,
    sessionId: input.sessionId ?? null,
    createdAt: now,
    expiresAt: input.expiresAt ?? null,
    meta: input.meta ?? {},
  }).run()

  return {
    id,
    question: input.question,
    context: input.context ?? null,
    status: 'pending',
    channelId: input.channelId ?? null,
    messageTs: null,
    threadTs: null,
    answer: null,
    answeredBy: null,
    answeredByName: null,
    answeredAt: null,
    answerSource: null,
    options: input.options ?? null,
    selectedOption: null,
    insightId: input.insightId ?? null,
    sessionId: input.sessionId ?? null,
    createdAt: now,
    expiresAt: input.expiresAt ?? null,
    meta: input.meta ?? {},
  }
}

export function getQuestion(id: string): SlackQuestion | null {
  const db = getDb()
  const row = db.select().from(slackQuestions).where(eq(slackQuestions.id, id)).get()
  if (!row) return null
  return rowToQuestion(row)
}

export function listQuestions(options?: {
  status?: string
  limit?: number
  offset?: number
}): SlackQuestion[] {
  const db = getDb()
  const { status, limit = 50, offset = 0 } = options ?? {}

  const query = status
    ? db.select().from(slackQuestions)
        .where(eq(slackQuestions.status, status))
        .orderBy(desc(slackQuestions.createdAt))
        .limit(limit)
        .offset(offset)
    : db.select().from(slackQuestions)
        .orderBy(desc(slackQuestions.createdAt))
        .limit(limit)
        .offset(offset)

  return query.all().map(rowToQuestion)
}

export function updateQuestionPosted(id: string, channelId: string, messageTs: string) {
  const db = getDb()
  db.update(slackQuestions)
    .set({ status: 'posted', channelId, messageTs })
    .where(eq(slackQuestions.id, id))
    .run()
}

export function updateQuestionAnswer(id: string, data: {
  answer: string
  answeredBy: string
  answeredByName?: string
  answerSource: 'thread' | 'button' | 'api'
  selectedOption?: string
  threadTs?: string
}) {
  const db = getDb()
  db.update(slackQuestions)
    .set({
      status: 'answered',
      answer: data.answer,
      answeredBy: data.answeredBy,
      answeredByName: data.answeredByName ?? null,
      answeredAt: Date.now(),
      answerSource: data.answerSource,
      selectedOption: data.selectedOption ?? null,
      threadTs: data.threadTs ?? null,
    })
    .where(eq(slackQuestions.id, id))
    .run()
}

export function getQuestionsByInsightId(insightId: string): SlackQuestion[] {
  const db = getDb()
  const rows = db.select().from(slackQuestions)
    .where(eq(slackQuestions.insightId, insightId))
    .orderBy(desc(slackQuestions.createdAt))
    .all()
  return rows.map(rowToQuestion)
}

// --- Thread reply accumulation ---

export type ThreadReply = {
  text: string
  userId: string
  userName?: string
  ts: string
  receivedAt: number
}

export function addThreadReply(questionId: string, reply: ThreadReply): void {
  const db = getDb()
  const row = db.select().from(slackQuestions).where(eq(slackQuestions.id, questionId)).get()
  if (!row) return

  const meta = (row.meta ?? {}) as Record<string, unknown>
  const replies = (meta.threadReplies ?? []) as ThreadReply[]
  replies.push(reply)

  db.update(slackQuestions)
    .set({ meta: { ...meta, threadReplies: replies } })
    .where(eq(slackQuestions.id, questionId))
    .run()
}

export function getThreadReplies(questionId: string): ThreadReply[] {
  const q = getQuestion(questionId)
  if (!q) return []
  return ((q.meta as any)?.threadReplies ?? []) as ThreadReply[]
}

export function markQuestionAnsweredFromReplies(questionId: string): void {
  const db = getDb()
  const q = getQuestion(questionId)
  if (!q) return

  const replies = ((q.meta as any)?.threadReplies ?? []) as ThreadReply[]
  if (replies.length === 0) return

  const combinedAnswer = replies
    .map(r => `${r.userName || r.userId}: ${r.text}`)
    .join('\n')
  const firstReply = replies[0]

  db.update(slackQuestions)
    .set({
      status: 'answered',
      answer: combinedAnswer,
      answeredBy: firstReply.userId,
      answeredByName: firstReply.userName ?? null,
      answeredAt: Date.now(),
      answerSource: 'thread',
    })
    .where(eq(slackQuestions.id, questionId))
    .run()
}

export function updateQuestionMeta(questionId: string, patch: Record<string, unknown>): void {
  const db = getDb()
  const row = db.select().from(slackQuestions).where(eq(slackQuestions.id, questionId)).get()
  if (!row) return

  const meta = (row.meta ?? {}) as Record<string, unknown>
  db.update(slackQuestions)
    .set({ meta: { ...meta, ...patch } })
    .where(eq(slackQuestions.id, questionId))
    .run()
}

export function findQuestionByThread(channelId: string, messageTs: string): SlackQuestion | null {
  const db = getDb()
  const row = db.select().from(slackQuestions)
    .where(and(eq(slackQuestions.channelId, channelId), eq(slackQuestions.messageTs, messageTs)))
    .get()
  if (!row) return null
  return rowToQuestion(row)
}

// --- Integration Configs ---

export type IntegrationConfig = {
  id: string
  config: Record<string, unknown>
  updatedAt: number
}

export function getIntegrationConfig(id: string): IntegrationConfig | null {
  const db = getDb()
  const row = db.select().from(integrationConfigs).where(eq(integrationConfigs.id, id)).get()
  if (!row) return null
  return {
    id: row.id,
    config: row.config as Record<string, unknown>,
    updatedAt: row.updatedAt,
  }
}

export function setIntegrationConfig(id: string, config: Record<string, unknown>) {
  const db = getDb()
  const existing = db.select().from(integrationConfigs).where(eq(integrationConfigs.id, id)).get()
  const now = Date.now()

  if (existing) {
    db.update(integrationConfigs)
      .set({ config: config as any, updatedAt: now })
      .where(eq(integrationConfigs.id, id))
      .run()
  } else {
    db.insert(integrationConfigs).values({
      id,
      config: config as any,
      updatedAt: now,
    }).run()
  }
}
