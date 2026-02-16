import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import type { Server as SocketIOServer } from 'socket.io'
import { normalize } from './normalize'
import { addEvent, getSession, getSessionEvents, getSessionEventsPaginated, listSessions, deleteSession, clearAll, updateSessionMeta, updateSessionUserId, archiveSession, createInvite, getInviteByToken, listInvites, markInviteUsed, deleteInvite } from './db'
import { listInsights, getInsight, deleteInsight } from './db/insights'
import { createAuth, migrateAuth } from './auth'
import type { IngestPayload } from './types'

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

export function createRouter(io: SocketIOServer) {
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

    return null // Not handled
  }
}
