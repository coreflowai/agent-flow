import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import type { Server as SocketIOServer } from 'socket.io'
import { normalize } from './normalize'
import { addEvent, getSession, getSessionEvents, getSessionEventsPaginated, listSessions, deleteSession, clearAll, updateSessionMeta, updateSessionUserId, archiveSession, createInvite, getInviteByToken, listInvites, markInviteUsed, deleteInvite } from './db'
import { listInsights, getInsight, deleteInsight } from './db/insights'
import { addQuestion, getQuestion, listQuestions, updateQuestionAnswer, getIntegrationConfig, setIntegrationConfig } from './db/slack'
import { createAuth, migrateAuth } from './auth'
import type { EventEmitter } from 'events'
import type { IngestPayload, CreateSlackQuestionInput, CreateDataSourceInput, UpdateDataSourceInput } from './types'
import type { SlackBot } from './slack'
import type { SourceManager } from './sources'
import { listSourceEntries, getEntryCount } from './db/sources'

function expandPath(p: string): string {
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2))
  return p
}

function extractLastAssistantMessage(transcriptPath: string): string | null {
  try {
    const resolved = expandPath(transcriptPath)
    if (!existsSync(resolved)) return null
    const content = readFileSync(resolved, 'utf-8')
    const lines = content.trim().split('\n')
    // Read backwards to find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.type === 'assistant' && entry.message?.content) {
          const texts = entry.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
          if (texts.length > 0) return texts.join('\n')
        }
      } catch {}
    }
  } catch {}
  return null
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createRouter(io: SocketIOServer, slackBot?: { bot: SlackBot | null, restart: (config: { botToken: string; appToken: string; channel: string; adminUserId?: string }) => Promise<void> }, internalBus?: EventEmitter, sourceManager?: SourceManager) {
  return async function handleRequest(req: Request, userId?: string): Promise<Response | null> {
    const url = new URL(req.url)
    const { pathname } = url

    // POST /api/ingest
    if (req.method === 'POST' && pathname === '/api/ingest') {
      try {
        const payload = (await req.json()) as IngestPayload
        if (!payload.source || !payload.sessionId || !payload.event) {
          return json({ error: 'Missing required fields: source, sessionId, event' }, 400)
        }

        // Server-side transcript parsing for Stop events
        if (payload.event.hook_event_name === 'Stop' && !payload.event.result && payload.event.transcript_path) {
          const text = extractLastAssistantMessage(payload.event.transcript_path as string)
          if (text) payload.event.result = text
        }

        const event = normalize(payload)
        addEvent(event)

        // Persist user info into session metadata
        if (payload.user && Object.keys(payload.user).length > 0) {
          updateSessionMeta(event.sessionId, { user: payload.user })
          const userId = payload.user.githubUsername || payload.user.email || payload.user.osUser || null
          if (userId) updateSessionUserId(event.sessionId, userId)
        }

        // Persist git info into session metadata
        if (payload.git && Object.keys(payload.git).length > 0) {
          updateSessionMeta(event.sessionId, { git: payload.git })
        }

        // Broadcast to Socket.IO subscribers
        io.to(`session:${event.sessionId}`).emit('event', event)
        io.emit('session:update', getSession(event.sessionId))

        return json({ ok: true, eventId: event.id })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to process event' }, 500)
      }
    }

    // GET /api/sessions
    if (req.method === 'GET' && pathname === '/api/sessions') {
      const userId = url.searchParams.get('userId') || undefined
      return json(listSessions(userId))
    }

    // GET /api/sessions/:id/events — paginated events
    if (req.method === 'GET' && pathname.match(/^\/api\/sessions\/[^/]+\/events$/)) {
      const id = pathname.replace('/api/sessions/', '').replace('/events', '')
      const session = getSession(id)
      if (!session) return json({ error: 'Session not found' }, 404)
      const limit = parseInt(url.searchParams.get('limit') || '200', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      return json(getSessionEventsPaginated(id, { limit, offset }))
    }

    // GET /api/sessions/:id
    if (req.method === 'GET' && pathname.startsWith('/api/sessions/')) {
      const id = pathname.replace('/api/sessions/', '')
      const session = getSession(id)
      if (!session) return json({ error: 'Session not found' }, 404)
      const events = getSessionEvents(id)
      return json({ ...session, events })
    }

    // POST /api/sessions/:id/archive
    if (req.method === 'POST' && pathname.match(/^\/api\/sessions\/[^/]+\/archive$/)) {
      const id = pathname.replace('/api/sessions/', '').replace('/archive', '')
      const session = getSession(id)
      if (!session) return json({ error: 'Session not found' }, 404)
      archiveSession(id)
      io.emit('session:update', getSession(id))
      return json({ ok: true })
    }

    // DELETE /api/sessions/:id
    if (req.method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
      const id = pathname.replace('/api/sessions/', '')
      deleteSession(id)
      io.emit('session:deleted', id)
      return json({ ok: true })
    }

    // DELETE /api/sessions
    if (req.method === 'DELETE' && pathname === '/api/sessions') {
      clearAll()
      io.emit('sessions:cleared')
      return json({ ok: true })
    }

    // GET /setup/hook.sh - serves the Claude Code hook script with correct URL and API key
    if (req.method === 'GET' && pathname === '/setup/hook.sh') {
      const proto = req.headers.get('x-forwarded-proto') || 'http'
      const origin = req.headers.get('host') ? `${proto}://${req.headers.get('host')}` : 'http://localhost:3333'
      const apiKeyFromReq = req.headers.get('x-api-key') || ''
      const script = `#!/bin/bash
# AgentFlow - Claude Code Hook Adapter
# Reads hook JSON from stdin, POSTs to AgentFlow server
# Captures user identity from git config and GitHub CLI
AGENT_FLOW_URL="\${AGENT_FLOW_URL:-${origin}}"
AGENT_FLOW_API_KEY="\${AGENT_FLOW_API_KEY:-${apiKeyFromReq}}"
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

# Incremental transcript reading for real-time assistant text
# Uses a position file to track lines already processed
if [ "$HOOK_EVENT" = "PreToolUse" ] || [ "$HOOK_EVENT" = "Stop" ]; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    POS_FILE="/tmp/agent-flow-\${SESSION_ID}.pos"
    LAST_POS=0
    [ -f "$POS_FILE" ] && LAST_POS=$(cat "$POS_FILE")
    CURRENT_POS=$(awk 'END{print NR}' "$TRANSCRIPT")

    if [ "$CURRENT_POS" -gt "$LAST_POS" ]; then
      NEW_TEXT=$(awk "NR > $LAST_POS" "$TRANSCRIPT" | while IFS= read -r line; do
        T=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
        if [ "$T" = "assistant" ]; then
          echo "$line" | jq -r '[.message.content[]? | select(.type == "text") | .text] | join("\\n")' 2>/dev/null
        fi
      done | sed '/^\$/d')

      if [ -n "$NEW_TEXT" ]; then
        if [ "$HOOK_EVENT" = "Stop" ]; then
          INPUT=$(echo "$INPUT" | jq --arg msg "$NEW_TEXT" '. + {result: $msg}')
        else
          curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \\
            -H "Content-Type: application/json" \\
            \${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \\
            -d "$(jq -n --arg s "$SESSION_ID" --arg msg "$NEW_TEXT" \\
              '{source:"claude-code",sessionId:$s,event:{hook_event_name:"message.assistant",session_id:$s,message:$msg}}')"
        fi
      fi
    fi

    echo "$CURRENT_POS" > "$POS_FILE"
    [ "$HOOK_EVENT" = "Stop" ] && rm -f "$POS_FILE"
  fi
fi

# Gather user identity
GIT_NAME=$(git config user.name 2>/dev/null || true)
GIT_EMAIL=$(git config user.email 2>/dev/null || true)
OS_USER="\${USER:-$(whoami 2>/dev/null || true)}"

# GitHub identity (via gh CLI if available)
GH_JSON=$(timeout 3 gh api user 2>/dev/null || true)
GH_LOGIN=""
GH_ID=""
if [ -n "$GH_JSON" ]; then
  GH_LOGIN=$(echo "$GH_JSON" | jq -r '.login // empty')
  GH_ID=$(echo "$GH_JSON" | jq -r '.id // empty')
fi

USER_OBJ=$(jq -n \\
  --arg name "$GIT_NAME" \\
  --arg email "$GIT_EMAIL" \\
  --arg osUser "$OS_USER" \\
  --arg ghUser "$GH_LOGIN" \\
  --arg ghId "$GH_ID" \\
  '{} +
   (if $name   != "" then {name: $name}             else {} end) +
   (if $email  != "" then {email: $email}            else {} end) +
   (if $osUser != "" then {osUser: $osUser}          else {} end) +
   (if $ghUser != "" then {githubUsername: $ghUser}   else {} end) +
   (if $ghId   != "" then {githubId: ($ghId | tonumber)} else {} end)')

# Gather git repo info
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || true)
GIT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
GIT_REMOTE=$(git remote get-url origin 2>/dev/null || true)
GIT_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || true)
GIT_WORKDIR=""
[ -n "$GIT_TOPLEVEL" ] && GIT_WORKDIR=$(basename "$GIT_TOPLEVEL")
GIT_REPO_NAME=""
[ -n "$GIT_REMOTE" ] && GIT_REPO_NAME=$(echo "$GIT_REMOTE" | sed -E 's#(\\.git)$##' | sed -E 's#^.+[:/]([^/]+/[^/]+)$#\\1#')
[ -n "$GIT_REMOTE" ] && GIT_REMOTE=$(echo "$GIT_REMOTE" | sed -E 's#https://[^@]+@#https://#')

GIT_OBJ=$(jq -n \\
  --arg commit "$GIT_COMMIT" --arg branch "$GIT_BRANCH" \\
  --arg remote "$GIT_REMOTE" --arg repoName "$GIT_REPO_NAME" \\
  --arg workDir "$GIT_WORKDIR" \\
  '{} +
   (if $commit   != "" then {commit: $commit}     else {} end) +
   (if $branch   != "" then {branch: $branch}     else {} end) +
   (if $remote   != "" then {remote: $remote}     else {} end) +
   (if $repoName != "" then {repoName: $repoName} else {} end) +
   (if $workDir  != "" then {workDir: $workDir}   else {} end)')

curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \\
  -H "Content-Type: application/json" \\
  \${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \\
  -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$INPUT" --argjson u "$USER_OBJ" --argjson g "$GIT_OBJ" \\
    '{source:"claude-code",sessionId:$s,event:$e,user:$u,git:$g}')"
`
      return new Response(script, {
        headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="agent-flow-hook.sh"' },
      })
    }

    // GET /setup/opencode-plugin.ts - serves the Open Code plugin with correct URL and API key
    if (req.method === 'GET' && pathname === '/setup/opencode-plugin.ts') {
      const proto = req.headers.get('x-forwarded-proto') || 'http'
      const origin = req.headers.get('host') ? `${proto}://${req.headers.get('host')}` : 'http://localhost:3333'
      const apiKeyFromReq = req.headers.get('x-api-key') || ''
      const script = `/**
 * AgentFlow - Open Code Plugin Adapter
 *
 * Install: copy to .opencode/plugin/agent-flow.ts (project) or ~/.config/opencode/plugin/agent-flow.ts (global)
 */

const AGENT_FLOW_URL = process.env.AGENT_FLOW_URL || "${origin}";
const AGENT_FLOW_API_KEY = process.env.AGENT_FLOW_API_KEY || "${apiKeyFromReq}";

function getUser() {
  try {
    const { execSync } = require("child_process");
    let name = "";
    try { name = execSync("gh api user --jq .login", { encoding: "utf-8", timeout: 3000 }).trim(); } catch {}
    if (!name) try { name = execSync("git config user.name", { encoding: "utf-8" }).trim(); } catch {}
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    const osUser = process.env.USER || require("os").userInfo().username;
    const user: Record<string, unknown> = {};
    if (name) user.name = name;
    if (email) user.email = email;
    if (osUser) user.osUser = osUser;
    return user;
  } catch {
    return undefined;
  }
}

function getGitInfo() {
  try {
    const { execSync } = require("child_process");
    const run = (cmd: string) => { try { return execSync(cmd, { encoding: "utf-8" }).trim(); } catch { return ""; } };
    const commit = run("git rev-parse --short HEAD");
    const branch = run("git symbolic-ref --short HEAD");
    let remote = run("git remote get-url origin");
    const topLevel = run("git rev-parse --show-toplevel");
    const workDir = topLevel ? require("path").basename(topLevel) : "";
    let repoName = "";
    if (remote) {
      const m = remote.match(/[:/]([^/]+\\/[^/]+?)(?:\\.git)?$/);
      if (m) repoName = m[1];
      remote = remote.replace(/https:\\/\\/[^@]+@/, "https://");
    }
    const git: Record<string, string> = {};
    if (commit) git.commit = commit;
    if (branch) git.branch = branch;
    if (remote) git.remote = remote;
    if (repoName) git.repoName = repoName;
    if (workDir) git.workDir = workDir;
    return Object.keys(git).length > 0 ? git : undefined;
  } catch {
    return undefined;
  }
}

const user = getUser();
const gitInfo = getGitInfo();
const messageRoles = new Map<string, string>();
const finalizedParts = new Set<string>();

function post(sessionId: string, event: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AGENT_FLOW_API_KEY) headers["x-api-key"] = AGENT_FLOW_API_KEY;
  fetch(AGENT_FLOW_URL + "/api/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "opencode", sessionId, event, ...(user ? { user } : {}), ...(gitInfo ? { git: gitInfo } : {}) }),
  }).catch(() => {});
}

function extractSessionId(event: any): string | null {
  if (event.properties?.sessionID) return event.properties.sessionID;
  if (event.properties?.info?.sessionID) return event.properties.info.sessionID;
  if (event.properties?.part?.sessionID) return event.properties.part.sessionID;
  if (event.type?.startsWith("session.") && event.properties?.info?.id) return event.properties.info.id;
  return null;
}

export const AgentFlowPlugin = async () => {
  return {
    name: "agent-flow",
    event: async ({ event }: { event: any }) => {
      const sessionId = extractSessionId(event);
      if (!sessionId) return;
      if (event.type === "message.updated" && event.properties?.info) {
        const msg = event.properties.info;
        if (msg.id && msg.role) messageRoles.set(msg.id, msg.role);
      }
      if (event.type === "message.part.updated") {
        const part = event.properties?.part;
        if (!part) return;
        const partId = part.id;
        const partType = part.type;
        if (partType === "text" || partType === "reasoning") {
          if (part.time && !part.time.end) return;
          if (finalizedParts.has(partId)) return;
          finalizedParts.add(partId);
        }
        if (partType === "tool") {
          const status = part.state?.status;
          const key = partId + ":" + status;
          if (finalizedParts.has(key)) return;
          finalizedParts.add(key);
        }
        const role = part.messageID ? messageRoles.get(part.messageID) : undefined;
        const properties = role ? { ...event.properties, _role: role } : event.properties;
        post(sessionId, { type: event.type, properties });
        return;
      }
      post(sessionId, { type: event.type, properties: event.properties });
    },
  };
};
`
      return new Response(script, {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="agent-flow.ts"',
        },
      })
    }

    // POST /api/invites — create invite (auth required, userId passed in)
    if (req.method === 'POST' && pathname === '/api/invites') {
      if (!userId) return json({ error: 'Unauthorized' }, 401)
      try {
        const body = await req.json() as { email?: string }
        const { id, token } = createInvite(userId, body.email)
        const proto = req.headers.get('x-forwarded-proto') || 'http'
        const origin = req.headers.get('host') ? `${proto}://${req.headers.get('host')}` : 'http://localhost:3333'
        return json({ ok: true, invite: { id, token, url: `${origin}/invite.html?token=${token}` } })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to create invite' }, 500)
      }
    }

    // GET /api/invites — list all invites (auth required)
    if (req.method === 'GET' && pathname === '/api/invites') {
      if (!userId) return json({ error: 'Unauthorized' }, 401)
      return json(listInvites())
    }

    // DELETE /api/invites/:id — revoke invite (auth required)
    if (req.method === 'DELETE' && pathname.startsWith('/api/invites/')) {
      if (!userId) return json({ error: 'Unauthorized' }, 401)
      const id = pathname.replace('/api/invites/', '')
      deleteInvite(id)
      return json({ ok: true })
    }

    // GET /api/invites/check?token= — validate invite token (public)
    if (req.method === 'GET' && pathname === '/api/invites/check') {
      const token = url.searchParams.get('token')
      if (!token) return json({ error: 'Missing token' }, 400)
      const invite = getInviteByToken(token)
      if (!invite) return json({ valid: false, reason: 'Invalid invite link' })
      if (invite.usedAt) return json({ valid: false, reason: 'This invite has already been used' })
      if (Date.now() > invite.expiresAt) return json({ valid: false, reason: 'This invite has expired' })
      return json({ valid: true, email: invite.email || null })
    }

    // --- Insights API ---

    // GET /api/insights
    if (req.method === 'GET' && pathname === '/api/insights') {
      const userIdParam = url.searchParams.get('userId') || undefined
      const repoName = url.searchParams.get('repoName') || undefined
      const limit = parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      return json(listInsights({ userId: userIdParam, repoName, limit, offset }))
    }

    // GET /api/insights/:id
    if (req.method === 'GET' && pathname.startsWith('/api/insights/')) {
      const id = pathname.replace('/api/insights/', '')
      const insight = getInsight(id)
      if (!insight) return json({ error: 'Insight not found' }, 404)
      return json(insight)
    }

    // DELETE /api/insights/:id
    if (req.method === 'DELETE' && pathname.startsWith('/api/insights/')) {
      const id = pathname.replace('/api/insights/', '')
      deleteInsight(id)
      io.emit('insight:deleted', id)
      return json({ ok: true })
    }

    // POST /api/invites/redeem — redeem invite + create account (public)
    if (req.method === 'POST' && pathname === '/api/invites/redeem') {
      try {
        const body = await req.json() as { token: string; email: string; password: string; name?: string }
        if (!body.token || !body.email || !body.password) {
          return json({ error: 'Missing required fields: token, email, password' }, 400)
        }
        const invite = getInviteByToken(body.token)
        if (!invite) return json({ error: 'Invalid invite link' }, 400)
        if (invite.usedAt) return json({ error: 'This invite has already been used' }, 400)
        if (Date.now() > invite.expiresAt) return json({ error: 'This invite has expired' }, 400)

        // Create user with sign-up enabled
        const auth = createAuth({ disableSignUp: false })
        const result = await auth.api.signUpEmail({
          body: {
            email: body.email,
            password: body.password,
            name: body.name || body.email.split('@')[0],
          },
        })

        markInviteUsed(invite.id, result.user.id)
        return json({ ok: true })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to create account' }, 500)
      }
    }

    // --- Slack Questions API ---

    // POST /api/slack/questions — create + post question
    if (req.method === 'POST' && pathname === '/api/slack/questions') {
      try {
        const input = (await req.json()) as CreateSlackQuestionInput
        if (!input.question) return json({ error: 'Missing required field: question' }, 400)
        const question = addQuestion(input)
        // Post to Slack if bot is connected
        if (slackBot?.bot?.isConnected()) {
          const posted = await slackBot.bot.postQuestion(question.id)
          if (posted) return json(posted)
        }
        return json(question)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to create question' }, 500)
      }
    }

    // GET /api/slack/questions — list questions
    if (req.method === 'GET' && pathname === '/api/slack/questions') {
      const status = url.searchParams.get('status') || undefined
      const limit = parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      return json(listQuestions({ status, limit, offset }))
    }

    // POST /api/slack/questions/:id/answer — manually answer via API
    if (req.method === 'POST' && pathname.match(/^\/api\/slack\/questions\/[^/]+\/answer$/)) {
      const id = pathname.replace('/api/slack/questions/', '').replace('/answer', '')
      const question = getQuestion(id)
      if (!question) return json({ error: 'Question not found' }, 404)
      if (question.status === 'answered') return json({ error: 'Already answered' }, 400)
      try {
        const body = (await req.json()) as { answer: string; selectedOption?: string }
        if (!body.answer) return json({ error: 'Missing required field: answer' }, 400)
        updateQuestionAnswer(id, {
          answer: body.answer,
          answeredBy: userId || 'api',
          answerSource: 'api',
          selectedOption: body.selectedOption,
        })
        const updated = getQuestion(id)
        if (updated) {
          io.emit('slack:question:answered', updated)
          if (internalBus) internalBus.emit('question:answered', updated)
        }
        return json(updated)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to answer question' }, 500)
      }
    }

    // GET /api/slack/questions/:id — get single question
    if (req.method === 'GET' && pathname.match(/^\/api\/slack\/questions\/[^/]+$/)) {
      const id = pathname.replace('/api/slack/questions/', '')
      const question = getQuestion(id)
      if (!question) return json({ error: 'Question not found' }, 404)
      return json(question)
    }

    // --- Integration Config API ---

    // GET /api/integrations/slack — get config (tokens masked)
    if (req.method === 'GET' && pathname === '/api/integrations/slack') {
      const config = getIntegrationConfig('slack')
      if (!config) return json({ configured: false })
      const c = config.config as Record<string, string>
      return json({
        configured: true,
        botToken: c.botToken ? maskToken(c.botToken) : null,
        appToken: c.appToken ? maskToken(c.appToken) : null,
        channel: c.channel || null,
        adminUserId: c.adminUserId || null,
        connected: slackBot?.bot?.isConnected() || false,
      })
    }

    // POST /api/integrations/slack — save config, (re)start bot
    if (req.method === 'POST' && pathname === '/api/integrations/slack') {
      try {
        const body = (await req.json()) as { botToken?: string; appToken?: string; channel?: string; adminUserId?: string }
        // Merge with existing config — only overwrite provided fields
        const existing = getIntegrationConfig('slack')
        const prev = (existing?.config || {}) as Record<string, string>
        const config = {
          botToken: body.botToken && !body.botToken.includes('•') ? body.botToken : prev.botToken || '',
          appToken: body.appToken && !body.appToken.includes('•') ? body.appToken : prev.appToken || '',
          channel: body.channel || prev.channel || '',
          adminUserId: body.adminUserId !== undefined ? (body.adminUserId || '') : (prev.adminUserId || ''),
        }
        setIntegrationConfig('slack', config)

        // Restart bot with new config
        if (config.botToken && config.appToken && slackBot) {
          await slackBot.restart({ ...config, adminUserId: config.adminUserId || undefined })
        }

        return json({ ok: true, connected: slackBot?.bot?.isConnected() || false })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to save config' }, 500)
      }
    }

    // POST /api/integrations/slack/test — test connection
    if (req.method === 'POST' && pathname === '/api/integrations/slack/test') {
      if (slackBot?.bot) {
        const result = await slackBot.bot.testConnection()
        return json(result)
      }
      return json({ ok: false, error: 'Bot not configured' })
    }

    // GET /api/integrations/slack/status — get bot connection status
    if (req.method === 'GET' && pathname === '/api/integrations/slack/status') {
      return json({ connected: slackBot?.bot?.isConnected() || false })
    }

    // GET /api/integrations/slack/channels — list channels from connected bot
    if (req.method === 'GET' && pathname === '/api/integrations/slack/channels') {
      if (!slackBot?.bot?.isConnected()) {
        return json({ channels: [], error: 'Not connected' })
      }
      try {
        const channels = await slackBot.bot.listChannels()
        return json({ channels })
      } catch (err: any) {
        return json({ channels: [], error: err.message ?? 'Failed to list channels' })
      }
    }

    // GET /api/integrations/slack/users — list workspace users from connected bot
    if (req.method === 'GET' && pathname === '/api/integrations/slack/users') {
      if (!slackBot?.bot?.isConnected()) {
        return json({ users: [], error: 'Not connected' })
      }
      try {
        const users = await slackBot.bot.listUsers()
        return json({ users })
      } catch (err: any) {
        return json({ users: [], error: err.message ?? 'Failed to list users' })
      }
    }

    // --- Discord Integration Config ---

    // GET /api/integrations/discord — get config (token masked)
    if (req.method === 'GET' && pathname === '/api/integrations/discord') {
      const config = getIntegrationConfig('discord')
      if (!config) return json({ configured: false })
      const c = config.config as Record<string, string>
      return json({
        configured: true,
        botToken: c.botToken ? maskToken(c.botToken) : null,
      })
    }

    // POST /api/integrations/discord — save bot token
    if (req.method === 'POST' && pathname === '/api/integrations/discord') {
      try {
        const body = (await req.json()) as { botToken?: string }
        const existing = getIntegrationConfig('discord')
        const prev = (existing?.config || {}) as Record<string, string>
        const config = {
          botToken: body.botToken && !body.botToken.includes('•') ? body.botToken : prev.botToken || '',
        }
        setIntegrationConfig('discord', config)
        return json({ ok: true })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to save config' }, 500)
      }
    }

    // POST /api/integrations/discord/test — test bot token via Discord REST
    if (req.method === 'POST' && pathname === '/api/integrations/discord/test') {
      const config = getIntegrationConfig('discord')
      const botToken = (config?.config as any)?.botToken
      if (!botToken) return json({ ok: false, error: 'Bot token not configured' })
      try {
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${botToken}` },
        })
        const data = await res.json() as any
        if (!res.ok) return json({ ok: false, error: data.message || 'Auth failed' })
        return json({ ok: true, username: data.username, discriminator: data.discriminator, id: data.id })
      } catch (err: any) {
        return json({ ok: false, error: err.message || 'Network error' })
      }
    }

    // GET /api/integrations/discord/guilds — list guilds the bot is in
    if (req.method === 'GET' && pathname === '/api/integrations/discord/guilds') {
      const config = getIntegrationConfig('discord')
      const botToken = (config?.config as any)?.botToken
      if (!botToken) return json({ guilds: [], error: 'Bot token not configured' })
      try {
        const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: { Authorization: `Bot ${botToken}` },
        })
        if (!res.ok) {
          const data = await res.json() as any
          return json({ guilds: [], error: data.message || 'Failed to list guilds' })
        }
        const guilds = (await res.json() as any[]).map((g: any) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
        }))
        return json({ guilds })
      } catch (err: any) {
        return json({ guilds: [], error: err.message || 'Network error' })
      }
    }

    // GET /api/integrations/discord/channels?guildId=X — list text channels in a guild
    if (req.method === 'GET' && pathname === '/api/integrations/discord/channels') {
      const guildId = url.searchParams.get('guildId')
      if (!guildId) return json({ channels: [], error: 'Missing guildId parameter' })
      const config = getIntegrationConfig('discord')
      const botToken = (config?.config as any)?.botToken
      if (!botToken) return json({ channels: [], error: 'Bot token not configured' })
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${botToken}` },
        })
        if (!res.ok) {
          const data = await res.json() as any
          return json({ channels: [], error: data.message || 'Failed to list channels' })
        }
        const allChannels = await res.json() as any[]
        // type 0 = text channel
        const channels = allChannels
          .filter((c: any) => c.type === 0)
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            position: c.position,
          }))
          .sort((a: any, b: any) => a.position - b.position)
        return json({ channels })
      } catch (err: any) {
        return json({ channels: [], error: err.message || 'Network error' })
      }
    }

    // --- GitHub Integration Config ---

    // GET /api/integrations/github — get config (token masked)
    if (req.method === 'GET' && pathname === '/api/integrations/github') {
      const config = getIntegrationConfig('github')
      if (!config) return json({ configured: false })
      const c = config.config as Record<string, string>
      return json({
        configured: true,
        token: c.token ? maskToken(c.token) : null,
      })
    }

    // POST /api/integrations/github — save token
    if (req.method === 'POST' && pathname === '/api/integrations/github') {
      try {
        const body = (await req.json()) as { token?: string }
        const existing = getIntegrationConfig('github')
        const prev = (existing?.config || {}) as Record<string, string>
        const config = {
          token: body.token && !body.token.includes('•') ? body.token : prev.token || '',
        }
        setIntegrationConfig('github', config)
        return json({ ok: true })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to save config' }, 500)
      }
    }

    // POST /api/integrations/github/test — test token validity
    if (req.method === 'POST' && pathname === '/api/integrations/github/test') {
      const config = getIntegrationConfig('github')
      const token = (config?.config as any)?.token
      if (!token) return json({ ok: false, error: 'Token not configured' })
      try {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'AgentFlow/1.0',
          },
        })
        const data = await res.json() as any
        if (!res.ok) return json({ ok: false, error: data.message || 'Auth failed' })
        return json({ ok: true, login: data.login, name: data.name })
      } catch (err: any) {
        return json({ ok: false, error: err.message || 'Network error' })
      }
    }

    // --- Datadog Integration Config ---

    // GET /api/integrations/datadog — get config (keys masked)
    if (req.method === 'GET' && pathname === '/api/integrations/datadog') {
      const config = getIntegrationConfig('datadog')
      if (!config) return json({ configured: false })
      const c = config.config as Record<string, string>
      return json({
        configured: true,
        apiKey: c.apiKey ? maskToken(c.apiKey) : null,
        appKey: c.appKey ? maskToken(c.appKey) : null,
        site: c.site || 'datadoghq.com',
      })
    }

    // POST /api/integrations/datadog — save keys
    if (req.method === 'POST' && pathname === '/api/integrations/datadog') {
      try {
        const body = (await req.json()) as { apiKey?: string; appKey?: string; site?: string }
        const existing = getIntegrationConfig('datadog')
        const prev = (existing?.config || {}) as Record<string, string>
        const config = {
          apiKey: body.apiKey && !body.apiKey.includes('•') ? body.apiKey : prev.apiKey || '',
          appKey: body.appKey && !body.appKey.includes('•') ? body.appKey : prev.appKey || '',
          site: body.site || prev.site || 'datadoghq.com',
        }
        setIntegrationConfig('datadog', config)
        return json({ ok: true })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to save config' }, 500)
      }
    }

    // POST /api/integrations/datadog/test — validate API key
    if (req.method === 'POST' && pathname === '/api/integrations/datadog/test') {
      const config = getIntegrationConfig('datadog')
      const c = (config?.config || {}) as Record<string, string>
      const apiKey = c.apiKey
      const site = c.site || 'datadoghq.com'
      if (!apiKey) return json({ ok: false, error: 'API key not configured' })
      try {
        const res = await fetch(`https://api.${site}/api/v1/validate`, {
          headers: {
            'DD-API-KEY': apiKey,
            'User-Agent': 'AgentFlow/1.0',
          },
        })
        const data = await res.json() as any
        if (!res.ok) return json({ ok: false, error: data.errors?.[0] || 'Validation failed' })
        return json({ ok: true, valid: data.valid })
      } catch (err: any) {
        return json({ ok: false, error: err.message || 'Network error' })
      }
    }

    // --- Data Sources API ---

    // GET /api/sources — list all data sources with entry counts
    if (req.method === 'GET' && pathname === '/api/sources') {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const sources = sourceManager.getSources()
      const withCounts = sources.map(s => ({
        ...s,
        entryCount: getEntryCount(s.id),
      }))
      return json(withCounts)
    }

    // POST /api/sources — create data source
    if (req.method === 'POST' && pathname === '/api/sources') {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      try {
        const input = (await req.json()) as CreateDataSourceInput
        if (!input.name || !input.type || !input.config) {
          return json({ error: 'Missing required fields: name, type, config' }, 400)
        }
        const source = await sourceManager.addSource(input)
        return json(source)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to create source' }, 500)
      }
    }

    // POST /api/sources/:id/toggle — enable/disable
    if (req.method === 'POST' && pathname.match(/^\/api\/sources\/[^/]+\/toggle$/)) {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const id = pathname.replace('/api/sources/', '').replace('/toggle', '')
      try {
        const body = (await req.json()) as { enabled: boolean }
        const source = await sourceManager.toggleSource(id, body.enabled)
        if (!source) return json({ error: 'Source not found' }, 404)
        return json(source)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to toggle source' }, 500)
      }
    }

    // POST /api/sources/:id/sync — manual sync (RSS)
    if (req.method === 'POST' && pathname.match(/^\/api\/sources\/[^/]+\/sync$/)) {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const id = pathname.replace('/api/sources/', '').replace('/sync', '')
      try {
        const result = await sourceManager.syncNow(id)
        return json(result)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to sync source' }, 500)
      }
    }

    // GET /api/sources/:id/entries — paginated entries for a source
    if (req.method === 'GET' && pathname.match(/^\/api\/sources\/[^/]+\/entries$/)) {
      const id = pathname.replace('/api/sources/', '').replace('/entries', '')
      const limit = parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      return json(listSourceEntries({ dataSourceId: id, limit, offset }))
    }

    // GET /api/sources/:id — source detail
    if (req.method === 'GET' && pathname.match(/^\/api\/sources\/[^/]+$/) && !pathname.includes('/entries')) {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const id = pathname.replace('/api/sources/', '')
      const source = sourceManager.getSource(id)
      if (!source) return json({ error: 'Source not found' }, 404)
      return json({ ...source, entryCount: getEntryCount(id) })
    }

    // PUT /api/sources/:id — update source config/mapping
    if (req.method === 'PUT' && pathname.match(/^\/api\/sources\/[^/]+$/)) {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const id = pathname.replace('/api/sources/', '')
      try {
        const input = (await req.json()) as UpdateDataSourceInput
        const source = await sourceManager.updateSource(id, input)
        if (!source) return json({ error: 'Source not found' }, 404)
        return json(source)
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to update source' }, 500)
      }
    }

    // DELETE /api/sources/:id — delete source + entries
    if (req.method === 'DELETE' && pathname.match(/^\/api\/sources\/[^/]+$/)) {
      if (!sourceManager) return json({ error: 'Sources not enabled' }, 500)
      const id = pathname.replace('/api/sources/', '')
      await sourceManager.removeSource(id)
      return json({ ok: true })
    }

    // GET /api/source-entries — global entry feed (paginated, filterable by source)
    if (req.method === 'GET' && pathname === '/api/source-entries') {
      const dataSourceId = url.searchParams.get('dataSourceId') || undefined
      const limit = parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      return json(listSourceEntries({ dataSourceId, limit, offset }))
    }

    return null // Not handled
  }
}

function maskToken(token: string): string {
  if (!token || token.length < 8) return '••••'
  const prefix = token.slice(0, token.indexOf('-') + 1) || token.slice(0, 4)
  const last4 = token.slice(-4)
  return `${prefix}${'•'.repeat(8)}${last4}`
}
