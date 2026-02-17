export type AgentFlowEvent = {
  id: string
  sessionId: string
  timestamp: number
  source: 'claude-code' | 'codex' | 'opencode'
  category: 'session' | 'message' | 'tool' | 'error' | 'system'
  type: string
  role: 'user' | 'assistant' | 'system' | null
  text: string | null
  toolName: string | null
  toolInput: unknown | null
  toolOutput: unknown | null
  error: string | null
  meta: Record<string, unknown>
}

export type Session = {
  id: string
  source: 'claude-code' | 'codex' | 'opencode'
  startTime: number
  lastEventTime: number
  status: 'active' | 'completed' | 'error' | 'archived'
  lastEventType: string | null
  lastEventText: string | null
  eventCount: number
  metadata: Record<string, unknown>
  userId?: string | null
}

export type UserInfo = {
  name?: string
  email?: string
  osUser?: string
  githubUsername?: string
  githubId?: number
}

export type GitInfo = {
  commit?: string
  branch?: string
  remote?: string
  repoName?: string
  workDir?: string
}

export type IngestPayload = {
  source: 'claude-code' | 'codex' | 'opencode'
  sessionId: string
  event: Record<string, unknown>
  user?: UserInfo
  git?: GitInfo
}

// Insight types
export type FollowUpAction = {
  action: string
  priority: 'low' | 'medium' | 'high'
  category: 'tooling' | 'workflow' | 'knowledge' | 'other'
}

export type InsightTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type InsightMeta = {
  tokenUsage?: InsightTokenUsage
  model?: string
  durationMs?: number
  error?: string
  rawOutput?: string
}

export type Insight = {
  id: string
  userId: string
  repoName: string | null
  createdAt: number
  analysisWindowStart: number
  analysisWindowEnd: number
  sessionsAnalyzed: number
  eventsAnalyzed: number
  content: string
  categories: string[]
  followUpActions: FollowUpAction[]
  meta: InsightMeta
}

export type InsightAnalysisState = {
  id: string
  userId: string
  repoName: string | null
  lastAnalyzedAt: number
  lastEventTimestamp: number
}

// Slack question types
export type SlackQuestionOption = {
  id: string
  label: string
  style?: 'primary' | 'danger'
}

export type SlackQuestion = {
  id: string
  question: string
  context: string | null
  status: 'pending' | 'posted' | 'answered' | 'expired'
  channelId: string | null
  messageTs: string | null
  threadTs: string | null
  answer: string | null
  answeredBy: string | null
  answeredByName: string | null
  answeredAt: number | null
  answerSource: 'thread' | 'button' | 'api' | null
  options: SlackQuestionOption[] | null
  selectedOption: string | null
  insightId: string | null
  sessionId: string | null
  createdAt: number
  expiresAt: number | null
  meta: Record<string, unknown>
}

export type CreateSlackQuestionInput = {
  question: string
  context?: string
  channelId?: string
  options?: SlackQuestionOption[]
  insightId?: string
  sessionId?: string
  expiresAt?: number
  meta?: Record<string, unknown>
}
