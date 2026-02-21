import Anthropic from '@anthropic-ai/sdk'
import { tools as dbTools, executeSqlTool, executeSchemaTools } from '../insights/analyzer'
import { integrationToolDefinitions, executeIntegrationTool } from './tools'
import { MAX_TOOL_RESULT } from './tools/types'

type ImageInput = { mediaType: string; data: string }

type Conversation = {
  messages: Anthropic.MessageParam[]
  lastActivity: number
}

export type ChatHandler = {
  handleMessage: (threadTs: string, text: string, userName?: string, images?: ImageInput[]) => Promise<string>
  isChatThread: (threadTs: string) => boolean
  registerThread: (threadTs: string) => void
  seedHistory: (threadTs: string, messages: Array<{ role: 'user' | 'assistant'; text: string }>) => void
  cleanup: () => void
}

const MAX_TURNS = 20
const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

const SYSTEM_PROMPT = `You are Benny — a team member in this Slack workspace. You're naturally curious about what everyone's working on. You have a dry, witty sense of humor. You blend in naturally — you talk like a real person, not an AI assistant.

## #1 Rule: Never Guess
When you don't know something, use your tools to look it up. Never guess or fabricate answers. If your tools don't help, say you don't know.

## Personality
- Don't volunteer that you're an AI, but don't lie about it if directly asked.
- Be naturally conversational — helpful first, witty second. Answer the question first, then banter.
- Match the energy of the conversation. If someone's being casual, be casual. If they need something looked up, just do it without ceremony.
- Keep it short. You're texting in Slack, not writing emails. Don't pad responses with filler.
- When someone shares something off-topic or casual, just roll with it like a teammate would.

## Capabilities (use these naturally, don't advertise them)
- Search the web using the \`web_search\` tool when someone asks about current events, docs, or anything you'd google
- Read URLs shared in conversation using the \`web_fetch\` tool
- Understand images people share
- **GitHub**: Search code/issues (\`github_search\`), read files (\`github_read_file\`), browse repos (\`github_list_repos\`, \`github_list_directory\`), read PRs (\`github_read_pr\`, \`github_list_prs\`), read issues (\`github_read_issue\`, \`github_list_issues\`)
- **Discord**: List servers (\`discord_list_guilds\`), list channels (\`discord_list_channels\`), read messages (\`discord_read_messages\`)
- **Slack**: List channels (\`slack_list_channels\`), read channel history (\`slack_read_messages\`), search messages (\`slack_search_messages\`)
- **Datadog**: Query the Datadog API (\`datadog_api\`). Common endpoints:
  - Search logs: POST /api/v2/logs/events/search with body { "filter": { "query": "@service:foo", "from": "now-1h", "to": "now" }, "sort": "-timestamp", "page": { "limit": 10 } }
  - List monitors: GET /api/v1/monitor
  - Get metrics: GET /api/v1/query?from=<unix>&to=<unix>&query=<metric_query>
- Query the AgentFlow database using \`schema\` and \`sql\` tools when people ask about agent sessions, tool usage, errors, etc.

The AgentFlow database tracks AI agent coding sessions (Claude Code, Codex CLI, Open Code), events within sessions, data sources (Slack/Discord/RSS feeds), and ingested messages.

Use the \`schema\` tool first if you need to understand the database structure, then \`sql\` to query.

## Formatting
- Use Slack mrkdwn: *bold*, _italic_, \`code\`, \`\`\`blocks\`\`\`
- Links: <url|label>
- Keep data answers to the key takeaway, not a dump. Convert timestamps to human-readable.`

/**
 * Split text into Slack-safe chunks at paragraph/line boundaries.
 */
export function chunkForSlack(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to break at double newline (paragraph)
    let breakIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (breakIdx < maxLen * 0.3) {
      // Too early — try single newline
      breakIdx = remaining.lastIndexOf('\n', maxLen)
    }
    if (breakIdx < maxLen * 0.3) {
      // Still too early — break at space
      breakIdx = remaining.lastIndexOf(' ', maxLen)
    }
    if (breakIdx < maxLen * 0.3) {
      // Last resort — hard break
      breakIdx = maxLen
    }

    chunks.push(remaining.slice(0, breakIdx))
    remaining = remaining.slice(breakIdx).trimStart()
  }

  return chunks
}

// Combine DB tools, web search, and all integration tools
const chatTools: Anthropic.Messages.ToolUnion[] = [
  ...dbTools,
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as Anthropic.Messages.WebSearchTool20250305,
  ...integrationToolDefinitions,
]

export function createChatHandler(opts: { dbPath: string; sourcesDbPath?: string }): ChatHandler {
  const { dbPath, sourcesDbPath } = opts
  const conversations = new Map<string, Conversation>()
  const chatThreads = new Set<string>()

  // Periodic cleanup
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [ts, conv] of conversations) {
      if (now - conv.lastActivity > TTL_MS) {
        conversations.delete(ts)
        chatThreads.delete(ts)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  cleanupTimer.unref()

  function registerThread(threadTs: string) {
    chatThreads.add(threadTs)
  }

  function isChatThread(threadTs: string): boolean {
    return chatThreads.has(threadTs)
  }

  function seedHistory(threadTs: string, messages: Array<{ role: 'user' | 'assistant'; text: string }>): void {
    // Only seed if conversation doesn't already exist (prevents re-seeding on follow-ups)
    if (conversations.has(threadTs)) return
    if (messages.length === 0) return

    const params: Anthropic.MessageParam[] = []
    for (const msg of messages) {
      // Merge consecutive same-role messages (Anthropic API requires alternating roles)
      const last = params[params.length - 1]
      if (last && last.role === msg.role) {
        last.content = (last.content as string) + '\n' + msg.text
      } else {
        params.push({ role: msg.role, content: msg.text })
      }
    }

    // Ensure first message is user role (API requirement)
    while (params.length > 0 && params[0].role !== 'user') {
      params.shift()
    }

    if (params.length === 0) return

    conversations.set(threadTs, { messages: params, lastActivity: Date.now() })
  }

  async function handleMessage(threadTs: string, text: string, userName?: string, images?: ImageInput[]): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return 'Sorry, the AI backend is not configured (missing ANTHROPIC_API_KEY).'

    // Get or create conversation
    let conv = conversations.get(threadTs)
    if (!conv) {
      conv = { messages: [], lastActivity: Date.now() }
      conversations.set(threadTs, conv)
    }

    // Enforce turn cap
    // Count user turns (exclude tool_result-only messages which are part of the agentic loop)
    const userTurns = conv.messages.filter(m => {
      if (m.role !== 'user') return false
      if (typeof m.content === 'string') return true
      if (Array.isArray(m.content)) return m.content.some((b: any) => b.type === 'text' || b.type === 'image')
      return false
    }).length
    if (userTurns >= MAX_TURNS) {
      return "We've hit the conversation limit for this thread. Start a new thread by @mentioning me again!"
    }

    // Add user message (with optional images)
    const userText = userName ? `[${userName}]: ${text}` : text
    let userContent: Anthropic.MessageParam['content']
    if (images && images.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = images.map(img => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: img.data,
        },
      }))
      blocks.push({ type: 'text' as const, text: userText })
      userContent = blocks
    } else {
      userContent = userText
    }
    conv.messages.push({ role: 'user', content: userContent })
    conv.lastActivity = Date.now()

    const client = new Anthropic({ apiKey })
    const model = 'claude-sonnet-4-6'

    try {
      const maxIterations = 10
      // Trim history to last MAX_HISTORY messages to stay within token limits
      const MAX_HISTORY = 20
      if (conv.messages.length > MAX_HISTORY) {
        conv.messages = conv.messages.slice(-MAX_HISTORY)
        // Ensure first message is a user message (API requirement)
        while (conv.messages.length > 0 && conv.messages[0].role !== 'user') {
          conv.messages.shift()
        }
      }
      // Build a working copy of messages for the agentic loop
      const loopMessages = [...conv.messages]

      for (let i = 0; i < maxIterations; i++) {
        let response: Anthropic.Message
        try {
          response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: chatTools as any,
            messages: loopMessages,
          })
        } catch (apiErr: any) {
          // If image can't be processed, strip all image blocks and retry once
          if (apiErr?.status === 400 && /could not process image/i.test(apiErr?.message ?? '')) {
            console.warn('[ChatHandler] Image rejected by API, retrying without images')
            const stripped = loopMessages.map(m => {
              if (m.role !== 'user' || !Array.isArray(m.content)) return m
              const filtered = (m.content as Anthropic.ContentBlockParam[]).filter(b => b.type !== 'image')
              if (filtered.length === 0) return { ...m, content: '(shared an image that could not be processed)' }
              return { ...m, content: filtered }
            })
            response = await client.messages.create({
              model,
              max_tokens: 4096,
              system: SYSTEM_PROMPT,
              tools: chatTools as any,
              messages: stripped,
            })
          } else {
            throw apiErr
          }
        }

        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find(c => c.type === 'text')
          const reply = textBlock?.type === 'text' ? textBlock.text : 'I couldn\'t generate a response.'

          // Persist the final assistant message into conversation history
          conv.messages.push({ role: 'assistant', content: reply })
          return reply
        }

        if (response.stop_reason === 'tool_use') {
          const toolUseBlocks = response.content.filter(c => c.type === 'tool_use')

          // Add assistant message with tool use to loop
          loopMessages.push({ role: 'assistant', content: response.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of toolUseBlocks) {
            if (block.type !== 'tool_use') continue
            let result: string
            try {
              if (block.name === 'sql') {
                result = executeSqlTool((block.input as { query: string }).query, dbPath, sourcesDbPath)
              } else if (block.name === 'schema') {
                result = executeSchemaTools()
              } else {
                // Delegate to integration tools
                const integrationResult = await executeIntegrationTool(block.name, block.input as Record<string, unknown>)
                result = integrationResult ?? `Unknown tool: ${block.name}`
              }
              if (result.length > MAX_TOOL_RESULT) {
                result = result.slice(0, MAX_TOOL_RESULT) + '\n... (truncated — use LIMIT in your query for smaller results)'
              }
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
          }

          loopMessages.push({ role: 'user', content: toolResults })
        }
      }

      // Max iterations — persist what we have
      conv.messages.push({ role: 'assistant', content: 'I ran into a limit while processing. Could you rephrase your question?' })
      return 'I ran into a limit while processing. Could you rephrase your question?'
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[ChatHandler] Error:', err)
      return `Something went wrong: \`${errMsg}\``
    }
  }

  return {
    handleMessage,
    isChatThread,
    registerThread,
    seedHistory,
    cleanup: () => {
      clearInterval(cleanupTimer)
      conversations.clear()
      chatThreads.clear()
    },
  }
}
