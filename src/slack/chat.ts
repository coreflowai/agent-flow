import Anthropic from '@anthropic-ai/sdk'
import { tools as dbTools, executeSqlTool, executeSchemaTools } from '../insights/analyzer'
import { getIntegrationConfig } from '../db/slack'

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
- Search code, issues, and PRs on GitHub using the \`github_search\` tool
- Read files from GitHub repos using the \`github_read_file\` tool
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

// Extended tools: DB tools + web tools
const chatTools: Anthropic.Messages.ToolUnion[] = [
  ...dbTools,
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as Anthropic.Messages.WebSearchTool20250305,
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text content. Useful for reading links shared in conversation. Returns plain text with HTML tags stripped, truncated to 30KB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'github_search',
    description: 'Search code, issues, or PRs on GitHub. Returns top 10 results with file paths, repo names, and matched content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (GitHub search syntax supported)',
        },
        type: {
          type: 'string',
          enum: ['code', 'issues'],
          description: 'Type of search: "code" for code/files, "issues" for issues and PRs. Defaults to "code".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read a file from a GitHub repository. Returns the decoded file content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (user or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        path: {
          type: 'string',
          description: 'File path within the repository',
        },
        ref: {
          type: 'string',
          description: 'Branch, tag, or commit SHA. Defaults to the repo default branch.',
        },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
]

const MAX_FETCH_SIZE = 30_000

async function executeWebFetch(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AgentFlow-Bot/1.0' },
    })
    clearTimeout(timeout)

    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`

    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()

    // Strip HTML tags if it looks like HTML
    let cleaned = text
    if (contentType.includes('html') || text.trimStart().startsWith('<')) {
      cleaned = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }

    if (cleaned.length > MAX_FETCH_SIZE) {
      return cleaned.slice(0, MAX_FETCH_SIZE) + '\n... (truncated)'
    }
    return cleaned
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Error: Request timed out after 10 seconds'
    }
    return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`
  }
}

const MAX_TOOL_RESULT = 30_000

function getGitHubToken(): string | undefined {
  const config = getIntegrationConfig('github')
  const dbToken = (config?.config as any)?.token
  return dbToken || process.env.GITHUB_TOKEN
}

async function executeGitHubSearch(query: string, type: string): Promise<string> {
  const token = getGitHubToken()
  if (!token) return 'GitHub token not configured. Set it in the dashboard under Integrations → GitHub, or set the GITHUB_TOKEN environment variable.'

  try {
    const endpoint = type === 'issues'
      ? `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=10`
      : `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=10`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AgentFlow-Bot/1.0',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

    const data = await res.json() as any
    if (!data.items || data.items.length === 0) return `No results found for "${query}"`

    if (type === 'issues') {
      const lines = data.items.map((item: any) =>
        `- [${item.title}](${item.html_url}) — ${item.repository_url?.split('/').slice(-2).join('/') || ''} #${item.number} (${item.state})`
      )
      return `Found ${data.total_count} results:\n${lines.join('\n')}`
    }

    // Code search
    const lines = data.items.map((item: any) =>
      `- ${item.repository.full_name}: \`${item.path}\` — ${item.html_url}`
    )
    return `Found ${data.total_count} results:\n${lines.join('\n')}`
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Error: GitHub request timed out after 10 seconds'
    }
    return `Error searching GitHub: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function executeGitHubReadFile(owner: string, repo: string, path: string, ref?: string): Promise<string> {
  const token = getGitHubToken()
  if (!token) return 'GitHub token not configured. Set it in the dashboard under Integrations → GitHub, or set the GITHUB_TOKEN environment variable.'

  try {
    let url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
    if (ref) url += `?ref=${encodeURIComponent(ref)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AgentFlow-Bot/1.0',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return `GitHub API error: HTTP ${res.status} ${res.statusText}`

    const data = await res.json() as any
    if (data.type !== 'file') return `"${path}" is a ${data.type}, not a file`
    if (!data.content) return `No content found for "${path}"`

    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    if (content.length > MAX_TOOL_RESULT) {
      return content.slice(0, MAX_TOOL_RESULT) + '\n... (truncated)'
    }
    return content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Error: GitHub request timed out after 10 seconds'
    }
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`
  }
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
              } else if (block.name === 'web_fetch') {
                result = await executeWebFetch((block.input as { url: string }).url)
              } else if (block.name === 'github_search') {
                const input = block.input as { query: string; type?: string }
                result = await executeGitHubSearch(input.query, input.type || 'code')
              } else if (block.name === 'github_read_file') {
                const input = block.input as { owner: string; repo: string; path: string; ref?: string }
                result = await executeGitHubReadFile(input.owner, input.repo, input.path, input.ref)
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
    seedHistory,
    cleanup: () => {
      clearInterval(cleanupTimer)
      conversations.clear()
      chatThreads.clear()
    },
  }
}
