import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  startTime: integer('start_time').notNull(),
  lastEventTime: integer('last_event_time').notNull(),
  status: text('status').default('active'),
  metadata: text('metadata', { mode: 'json' }).default('{}'),
  userId: text('user_id'),
})

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  timestamp: integer('timestamp').notNull(),
  source: text('source').notNull(),
  category: text('category').notNull(),
  type: text('type').notNull(),
  role: text('role'),
  text: text('text'),
  toolName: text('tool_name'),
  toolInput: text('tool_input', { mode: 'json' }),
  toolOutput: text('tool_output', { mode: 'json' }),
  error: text('error'),
  meta: text('meta', { mode: 'json' }).default('{}'),
}, (table) => [
  index('idx_events_session').on(table.sessionId, table.timestamp),
])

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  email: text('email'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  usedBy: text('used_by'),
})

// Insights tables for AI-generated user behavior analysis
export const insights = sqliteTable('insights', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),           // GitHub username
  repoName: text('repo_name'),                 // e.g., "bennykok/agent-dog" (null = all repos)
  createdAt: integer('created_at').notNull(),
  analysisWindowStart: integer('analysis_window_start').notNull(),
  analysisWindowEnd: integer('analysis_window_end').notNull(),
  sessionsAnalyzed: integer('sessions_analyzed').notNull(),
  eventsAnalyzed: integer('events_analyzed').notNull(),
  content: text('content').notNull(),          // Markdown content
  categories: text('categories', { mode: 'json' }).$type<string[]>(),
  followUpActions: text('follow_up_actions', { mode: 'json' }),
  meta: text('meta', { mode: 'json' }),        // Token usage, model, duration, etc.
}, (table) => [
  index('idx_insights_user').on(table.userId, table.createdAt),
  index('idx_insights_repo').on(table.repoName, table.createdAt),
])

// Slack questions for human-in-the-loop
export const slackQuestions = sqliteTable('slack_questions', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  context: text('context'),
  status: text('status').notNull().default('pending'),    // pending | posted | answered | expired
  channelId: text('channel_id'),
  messageTs: text('message_ts'),
  threadTs: text('thread_ts'),
  answer: text('answer'),
  answeredBy: text('answered_by'),
  answeredByName: text('answered_by_name'),
  answeredAt: integer('answered_at'),
  answerSource: text('answer_source'),                    // thread | button | api
  options: text('options', { mode: 'json' }),              // SlackQuestionOption[]
  selectedOption: text('selected_option'),
  insightId: text('insight_id'),
  sessionId: text('session_id'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
  meta: text('meta', { mode: 'json' }).default('{}'),
}, (table) => [
  index('idx_slack_questions_status').on(table.status),
  index('idx_slack_questions_channel_msg').on(table.channelId, table.messageTs),
])

// Integration configs (key-value store for integration settings)
export const integrationConfigs = sqliteTable('integration_configs', {
  id: text('id').primaryKey(),                             // e.g. 'slack'
  config: text('config', { mode: 'json' }).notNull(),      // JSON config
  updatedAt: integer('updated_at').notNull(),
})

// Track last analysis state per user+repo combination
export const insightAnalysisState = sqliteTable('insight_analysis_state', {
  id: text('id').primaryKey(),                 // composite: `${userId}:${repoName || 'all'}`
  userId: text('user_id').notNull(),
  repoName: text('repo_name'),                 // null = all repos for user
  lastAnalyzedAt: integer('last_analyzed_at').notNull(),
  lastEventTimestamp: integer('last_event_timestamp').notNull(),
}, (table) => [
  index('idx_analysis_state_user').on(table.userId),
])
