import Anthropic from '@anthropic-ai/sdk'
import { tools, executeSqlTool, executeSchemaTools } from '../insights/analyzer'

type Conversation = {
  messages: Anthropic.MessageParam[]
  lastActivity: number
}

export type ChatHandler = {
  handleMessage: (threadTs: string, text: string, userName?: string) => Promise<string>
  isChatThread: (threadTs: string) => boolean
  registerThread: (threadTs: string) => void
  cleanup: () => void
}

const MAX_TURNS = 20
const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

const SYSTEM_PROMPT = `You are AgentFlow Assistant — a conversational AI that helps teams understand their AI agent usage data.

You have access to the AgentFlow database which tracks:
- **Sessions**: AI agent coding sessions from Claude Code, Codex CLI, Open Code
- **Events**: Individual actions within sessions (messages, tool calls, errors)
- **Data Sources**: External context feeds (Slack channels, Discord, RSS)
- **Source Entries**: Ingested messages from external data sources

Use the \`schema\` tool first if you need to understand the database structure, then use \`sql\` to query data.

## Response Guidelines
- Format responses using Slack mrkdwn (not standard Markdown):
  - Bold: *text* (single asterisks)
  - Italic: _text_
  - Code: \`inline\` or \`\`\`block\`\`\`
  - Lists: use bullet points with •  or dashes
  - Links: <url|label>
- Keep responses concise and actionable
- When showing data, summarize rather than dumping raw JSON
- If asked about something outside AgentFlow data, say so honestly
- Be conversational — you're a colleague, not a report generator
- For timestamps, convert from Unix ms to human-readable dates in your responses`

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

  async function handleMessage(threadTs: string, text: string, userName?: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return 'Sorry, the AI backend is not configured (missing ANTHROPIC_API_KEY).'

    // Get or create conversation
    let conv = conversations.get(threadTs)
    if (!conv) {
      conv = { messages: [], lastActivity: Date.now() }
      conversations.set(threadTs, conv)
    }

    // Enforce turn cap
    const userTurns = conv.messages.filter(m => m.role === 'user' && typeof m.content === 'string').length
    if (userTurns >= MAX_TURNS) {
      return "We've hit the conversation limit for this thread. Start a new thread by @mentioning me again!"
    }

    // Add user message
    const userContent = userName ? `[${userName}]: ${text}` : text
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
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools,
          messages: loopMessages,
        })

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
            const MAX_TOOL_RESULT = 30_000 // ~8K tokens cap per tool result
            try {
              if (block.name === 'sql') {
                result = executeSqlTool((block.input as { query: string }).query, dbPath, sourcesDbPath)
              } else if (block.name === 'schema') {
                result = executeSchemaTools()
              } else {
                result = `Unknown tool: ${block.name}`
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
    cleanup: () => {
      clearInterval(cleanupTimer)
      conversations.clear()
      chatThreads.clear()
    },
  }
}
