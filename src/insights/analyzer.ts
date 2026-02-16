import Anthropic from '@anthropic-ai/sdk'
import { Database } from 'bun:sqlite'
import { analysisToMarkdown, type AnalysisOutput } from './prompts'
import type { InsightMeta, FollowUpAction } from '../types'

export type AnalysisResult = {
  success: boolean
  content: string  // Markdown content
  categories: string[]
  followUpActions: FollowUpAction[]
  sessionsAnalyzed: number
  eventsAnalyzed: number
  meta: InsightMeta
  error?: string
}

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'sql',
    description: `Execute read-only SQL queries against the AgentFlow SQLite database.

Available tables:
- sessions: id, source, start_time, last_event_time, status, metadata (JSON with user/git info), user_id
- events: id, session_id, timestamp, source, category, type, role, text, tool_name, tool_input, tool_output, error, meta

The metadata JSON in sessions contains:
- user: { name, email, osUser, githubUsername, githubId }
- git: { commit, branch, remote, repoName, workDir }

Event categories: 'session', 'message', 'tool', 'error', 'system'
Event types: 'session.start', 'session.end', 'message.user', 'message.assistant', 'tool.start', 'tool.end', etc.

Returns results as JSON array. Only SELECT statements are allowed.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'SQL SELECT query to execute. Only SELECT statements allowed.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'schema',
    description: 'Get the AgentFlow database schema documentation. Use this to understand the database structure before writing SQL queries.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

/**
 * Execute the sql tool - read-only query against SQLite
 */
function executeSqlTool(query: string, dbPath: string): string {
  // Security: Only allow SELECT
  const normalized = query.trim().toUpperCase()
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries allowed')
  }

  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'ATTACH', 'DETACH']
  for (const kw of forbidden) {
    if (normalized.includes(kw)) {
      throw new Error(`Forbidden keyword: ${kw}`)
    }
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    const results = db.prepare(query).all()
    return JSON.stringify(results, null, 2)
  } finally {
    db.close()
  }
}

/**
 * Execute the schema tool - return database documentation
 */
function executeSchemaTools(): string {
  return `# AgentFlow Database Schema

## sessions
Stores AI agent session information.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Session identifier (UUID) |
| source | TEXT | Agent source: 'claude-code', 'codex', or 'opencode' |
| start_time | INTEGER | Unix timestamp (ms) of session start |
| last_event_time | INTEGER | Unix timestamp (ms) of last event |
| status | TEXT | Session status: 'active', 'completed', 'error', 'archived' |
| metadata | JSON | Contains user and git info (see below) |
| user_id | TEXT | GitHub username, email, or OS user |

### metadata.user object:
- name: git config user.name
- email: git config user.email
- osUser: system username
- githubUsername: GitHub username
- githubId: GitHub user ID (number)

### metadata.git object:
- commit: short commit hash
- branch: current branch name
- remote: git remote URL
- repoName: "owner/repo" format (e.g., "bennykok/agent-dog")
- workDir: working directory name

## events
Stores individual events within sessions.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Event UUID |
| session_id | TEXT FK | References sessions.id |
| timestamp | INTEGER | Unix timestamp (ms) |
| source | TEXT | Event source |
| category | TEXT | 'session', 'message', 'tool', 'error', 'system' |
| type | TEXT | Event type (see examples below) |
| role | TEXT | 'user', 'assistant', 'system', or null |
| text | TEXT | Message content |
| tool_name | TEXT | Tool name if tool event |
| tool_input | JSON | Tool arguments/parameters |
| tool_output | JSON | Tool results (truncated to 10KB) |
| error | TEXT | Error message if error event |
| meta | JSON | Additional event metadata |

### Event type examples:
- session.start, session.end
- message.user, message.assistant
- tool.start, tool.end
- error

## Useful Query Examples

### Get sessions for a specific user with git info:
\`\`\`sql
SELECT id, source, status,
       json_extract(metadata, '$.git.repoName') as repo,
       json_extract(metadata, '$.git.branch') as branch,
       datetime(start_time/1000, 'unixepoch') as started
FROM sessions
WHERE user_id = 'username'
ORDER BY last_event_time DESC
LIMIT 10;
\`\`\`

### Count events by type for a session:
\`\`\`sql
SELECT type, COUNT(*) as count
FROM events
WHERE session_id = 'xxx'
GROUP BY type
ORDER BY count DESC;
\`\`\`

### Find errors in recent sessions:
\`\`\`sql
SELECT e.session_id, e.error, e.timestamp,
       datetime(e.timestamp/1000, 'unixepoch') as time
FROM events e
WHERE e.category = 'error'
ORDER BY e.timestamp DESC
LIMIT 20;
\`\`\`

### Get tool usage statistics:
\`\`\`sql
SELECT tool_name, COUNT(*) as count
FROM events
WHERE tool_name IS NOT NULL
GROUP BY tool_name
ORDER BY count DESC;
\`\`\`

### Find user frustration indicators:
\`\`\`sql
SELECT * FROM events
WHERE category = 'error'
   OR (type = 'message.user' AND (
       text LIKE '%try again%'
       OR text LIKE '%not working%'
       OR text LIKE '%wrong%'
       OR text LIKE '%fix%'
   ))
ORDER BY timestamp DESC;
\`\`\`
`
}

/**
 * Build the analysis prompt
 */
function buildAnalysisPrompt(userId: string, repoName: string | null, sinceTimestamp: number): string {
  const repoContext = repoName
    ? `for repository "${repoName}"`
    : 'across all repositories'

  return `You are analyzing AI agent session data for user "${userId}" ${repoContext} to generate actionable insights.

## Your Task

Use the \`sql\` tool to query the AgentFlow database and analyze this user's recent sessions and events since timestamp ${sinceTimestamp} (${new Date(sinceTimestamp).toISOString()}).

First, use the \`schema\` tool to understand the database structure, then perform your analysis.

## Analysis Steps

1. **Gather Data**: Query recent sessions and events for this user${repoName ? ` in repo "${repoName}"` : ''}:
   - Sessions: WHERE user_id = '${userId}'${repoName ? ` AND json_extract(metadata, '$.git.repoName') = '${repoName}'` : ''}
   - Events: WHERE timestamp > ${sinceTimestamp}

2. **Analyze User Intent**: What was the user trying to accomplish?
   - Look at message.user events for their prompts/requests
   - Identify recurring themes and patterns
   - Note the types of tasks they're working on

3. **Identify Frustration Points**: Where did they struggle?
   - Look for error events (category = 'error')
   - Find repeated attempts at similar tasks
   - Check for messages containing "try again", "not working", "fix", etc.
   - Note tool failures or unexpected outputs

4. **Evaluate Tool Usage**: How are they using the AI agent?
   - Which tools are used most frequently?
   - Are there tools they could use more effectively?
   - Any patterns in tool usage that could be optimized?

5. **Generate Improvement Suggestions**: What could help them work better?
   - Based on observed patterns and struggles
   - Practical, actionable recommendations

## Output Format

Generate your response as valid JSON with this exact structure:

\`\`\`json
{
  "summary": "2-3 sentence overview of the analysis period",
  "userIntent": {
    "goals": ["goal1", "goal2"],
    "patterns": ["pattern1", "pattern2"]
  },
  "frustrationPoints": [
    {
      "description": "What happened",
      "severity": "low|medium|high",
      "evidence": "Quote or reference from the data"
    }
  ],
  "improvements": [
    {
      "title": "Short title",
      "description": "Detailed suggestion"
    }
  ],
  "followUpActions": [
    {
      "action": "Specific action to take",
      "priority": "low|medium|high",
      "category": "tooling|workflow|knowledge|other"
    }
  ],
  "stats": {
    "sessionsAnalyzed": 0,
    "eventsAnalyzed": 0,
    "timeRangeStart": "${new Date(sinceTimestamp).toISOString()}",
    "timeRangeEnd": "now"
  }
}
\`\`\`

Be specific, actionable, and base everything on the actual data from the database. If there's not enough data for meaningful analysis, say so in the summary.`
}

/**
 * Run the insight analysis using Anthropic API directly with tool use.
 */
export async function runAnalysis(
  userId: string,
  repoName: string | null,
  sinceTimestamp: number,
  dbPath: string
): Promise<AnalysisResult> {
  const startTime = Date.now()
  const prompt = buildAnalysisPrompt(userId, repoName, sinceTimestamp)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      success: false,
      content: '',
      categories: [],
      followUpActions: [],
      sessionsAnalyzed: 0,
      eventsAnalyzed: 0,
      meta: {
        durationMs: Date.now() - startTime,
        error: 'ANTHROPIC_API_KEY not set',
      },
      error: 'ANTHROPIC_API_KEY not set',
    }
  }

  const client = new Anthropic({ apiKey })
  const model = 'claude-sonnet-4-20250514'

  try {
    let messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt }
    ]

    let totalInputTokens = 0
    let totalOutputTokens = 0

    // Agentic loop - keep calling until we get a final response
    const maxIterations = 10
    for (let i = 0; i < maxIterations; i++) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        tools,
        messages,
      })

      totalInputTokens += response.usage.input_tokens
      totalOutputTokens += response.usage.output_tokens

      // Check if we're done (no more tool use)
      if (response.stop_reason === 'end_turn') {
        // Extract the text content
        const textContent = response.content.find(c => c.type === 'text')
        const content = textContent?.type === 'text' ? textContent.text : ''

        // Try to extract structured analysis
        const analysis = extractAnalysis(content)

        if (analysis) {
          const mdContent = analysisToMarkdown(analysis)
          const followUpActions: FollowUpAction[] = (analysis.followUpActions ?? []).map(a => ({
            action: a.action,
            priority: a.priority,
            category: a.category,
          }))

          const categories: string[] = []
          if (analysis.frustrationPoints?.some(fp => fp.severity === 'high')) {
            categories.push('high-frustration')
          }
          if (analysis.improvements?.length) {
            categories.push('has-improvements')
          }
          if (analysis.userIntent?.goals?.length) {
            categories.push('goals-identified')
          }

          return {
            success: true,
            content: mdContent,
            categories,
            followUpActions,
            sessionsAnalyzed: analysis.stats?.sessionsAnalyzed ?? 0,
            eventsAnalyzed: analysis.stats?.eventsAnalyzed ?? 0,
            meta: {
              durationMs: Date.now() - startTime,
              model,
              tokenUsage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
              },
            },
          }
        }

        // No structured analysis, return raw content
        return {
          success: true,
          content: content || 'No analysis generated',
          categories: [],
          followUpActions: [],
          sessionsAnalyzed: 0,
          eventsAnalyzed: 0,
          meta: {
            durationMs: Date.now() - startTime,
            model,
            tokenUsage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          },
        }
      }

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(c => c.type === 'tool_use')

        // Add assistant message with tool use
        messages.push({ role: 'assistant', content: response.content })

        // Process each tool call and add results
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of toolUseBlocks) {
          if (block.type !== 'tool_use') continue

          let result: string
          try {
            if (block.name === 'sql') {
              const input = block.input as { query: string }
              result = executeSqlTool(input.query, dbPath)
            } else if (block.name === 'schema') {
              result = executeSchemaTools()
            } else {
              result = `Unknown tool: ${block.name}`
            }
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          })
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }

    // Max iterations reached
    return {
      success: false,
      content: '',
      categories: [],
      followUpActions: [],
      sessionsAnalyzed: 0,
      eventsAnalyzed: 0,
      meta: {
        durationMs: Date.now() - startTime,
        model,
        tokenUsage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        },
        error: 'Max iterations reached',
      },
      error: 'Max iterations reached',
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      categories: [],
      followUpActions: [],
      sessionsAnalyzed: 0,
      eventsAnalyzed: 0,
      meta: {
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Extract structured analysis from text content.
 * Looks for JSON block in the response.
 */
function extractAnalysis(content: string): AnalysisOutput | null {
  if (!content) return null

  // Try to find JSON in code block
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1])
    } catch {
      // Continue looking
    }
  }

  // Try to find raw JSON object
  const jsonMatch = content.match(/\{[\s\S]*"summary"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // Return null
    }
  }

  return null
}
