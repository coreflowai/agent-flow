# AgentFlow

Real-time observability platform for AI agent sessions (Claude Code, Codex CLI, Claude Agent SDK, Open Code).

## Tech Stack

- **Runtime**: Bun
- **Database**: SQLite (WAL mode) with Drizzle ORM
- **WebSocket**: Socket.IO with `@socket.io/bun-engine`
- **Frontend**: Vanilla JS + DaisyUI/Tailwind CSS (served from `public/`)

## Commands

```bash
bun run dev          # Dev server with hot reload (port 3333)
bun run start        # Production start
bun test             # Run all tests
bunx drizzle-kit generate   # Generate migrations after schema changes
bunx drizzle-kit migrate    # Apply pending migrations
```

## Project Structure

```
server.ts                  # Entry point — reads PORT and AGENT_FLOW_DB env vars
src/
  server-factory.ts        # createServer() factory — returns { server, io, url, close }
  routes.ts                # API routes (createRouter(io))
  normalize.ts             # Event normalization per source (claude-code, codex, opencode)
  types.ts                 # Core types: AgentFlowEvent, Session, IngestPayload
  db/
    index.ts               # Database operations (initDb, addEvent, getSession, etc.)
    schema.ts              # Drizzle ORM table definitions (sessions, events)
public/
  index.html               # Dashboard UI
  app.js                   # Frontend: Socket.IO client, session/event rendering
adapters/
  claude-code-hooks.sh     # Bash hook for Claude Code integration
  claude-code-sdk.ts       # TypeScript adapter for Claude Agent SDK
  codex-pipe.sh            # Bash pipe wrapper for Codex CLI
  opencode-plugin.ts       # Open Code plugin adapter
  opencode-pipe.sh         # Bash pipe wrapper for Open Code CLI
tests/
  claude-code-streaming.test.ts
  codex-streaming.test.ts
  opencode-streaming.test.ts
  integration.test.ts
```

## Architecture

- **Server Factory pattern**: `createServer(options)` allows flexible config for production and testing (ephemeral DBs, custom ports)
- **Event Normalization**: `normalize.ts` converts raw hooks from different sources into a unified `AgentFlowEvent` format
- **Socket.IO Rooms**: Clients subscribe to per-session rooms for real-time event streaming
- **Derived session status**: `active` sessions auto-complete after 2 min idle (`STALE_TIMEOUT`)
- **Adapters are async/fire-and-forget**: Hook scripts run in background to not block the agent

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ingest` | Receive events (`{ source, sessionId, event }`) |
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Session detail + events |
| POST | `/api/sessions/:id/archive` | Archive session |
| DELETE | `/api/sessions/:id` | Delete session |
| DELETE | `/api/sessions` | Clear all |
| GET | `/setup/hook.sh` | Download hook script with correct server URL |
| GET | `/setup/opencode-plugin.ts` | Download Open Code plugin with correct server URL |

## Database

Two tables: `sessions` and `events`. Events reference sessions via `session_id`. JSON fields stored as TEXT. Index on `(session_id, timestamp)`.

Status is derived at read time — not updated in place. Migrations auto-apply on startup via `initDb()`.

## Event Type Conventions

Format: `{category}.{action}` — e.g. `session.start`, `tool.end`, `message.user`

Categories: `session`, `message`, `tool`, `error`, `system`

Tool outputs are truncated to 10KB (`MAX_OUTPUT_SIZE`).

## Naming Conventions

- **Factory functions**: `create*()` (createServer, createAgentFlowHooks)
- **Types**: PascalCase (AgentFlowEvent, IngestPayload)
- **DB columns**: snake_case in SQL, camelCase in TypeScript
- **Event types**: lowercase dot-separated (`tool.start`, `session.stop`)

## Testing

Tests use the server factory with ephemeral `/tmp` databases. Each test creates its own server instance and Socket.IO client.

- `postEvent()` helper sends events via HTTP
- `waitForEvents(count)` waits for Socket.IO broadcasts with timeout
- Integration tests spawn real CLI processes (120s timeout)

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3333` | Server port |
| `AGENT_FLOW_DB` | `agent-flow.db` | SQLite database path |
| `AGENT_FLOW_URL` | `http://localhost:3333` | Used by adapters to POST events |
| `GITHUB_TOKEN` | — | GitHub API token for Slack bot code search tools |

## Production

- **URL**: https://agent.coreflow.sh
- **Hosting**: Railway
- **API**: All `/api/*` routes require authentication via `x-api-key` header or session cookie
- Query sessions: `curl -H "x-api-key: $KEY" https://agent.coreflow.sh/api/sessions`

## Debugging Production

When investigating errors or unexpected behavior, always check Railway logs first:

```bash
railway logs --lines 50              # Last 50 lines from current deployment
railway logs --since 10m             # Logs from the last 10 minutes
railway logs --since 1h              # Logs from the last hour
railway logs --since 10m 2>&1 | grep -i error   # Filter for errors
```

Check these logs proactively when:
- A user reports something isn't working in production
- After deploying changes to verify they're working
- When debugging Slack/Discord integration issues (look for `[SlackBot]`, `[Curiosity]` prefixes)

## E2E Testing for Integration Features

**Every new integration feature must be verified end-to-end on production using browser automation.** Don't just ship code — verify the full user flow works.

### Browser Automation

Use Chrome browser tools (MCP `claude-in-chrome`) or [agent-browser](https://github.com/vercel-labs/agent-browser) for E2E verification:

1. **Navigate to production** (https://agent.coreflow.sh)
2. **Exercise the UI flow** — click through the feature as a user would
3. **Check the console** for errors (`read_console_messages`)
4. **Verify API responses** via `javascript_tool` (e.g. fetch endpoints and check data)
5. **Test the full loop** — if it's an ingestion feature, send a real message and confirm it arrives

### Checklist for Integration Features

For any Slack/Discord/RSS data source feature:

- [ ] **Dropdown/form works** — open the form, verify dropdowns populate, select items
- [ ] **Data saves correctly** — save and verify the API returns correct config (channel IDs, not names)
- [ ] **Messages flow through** — send a real message in the source (Slack/Discord), confirm it appears as a source entry in AgentFlow
- [ ] **Feed view shows entries** — check `/api/source-entries` returns the ingested message
- [ ] **Error cases** — verify graceful fallback when not connected (e.g. plain text input if Slack bot offline)

### Example: Slack Channel Dropdown (verified 2026-02-19)

1. Added `channels:read` + `groups:read` OAuth scopes in Slack API settings, reinstalled app
2. Opened Data Sources → Add Source → Slack Channel type
3. Clicked channel input → dropdown showed 68 channels with `#name (N members)` format
4. Selected `#off-topic` → input showed `#off-topic`, hidden field stored `C092M7LNLJC`
5. Saved as `off-topic-test` → source created with correct `channelId`
6. Sent test message in Slack `#off-topic` → message ingested within seconds
7. Verified via API: `entries: 1`, content matched the test message

### Integration API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/integrations/slack/channels` | List Slack channels (requires connected bot) |
| GET | `/api/integrations/discord` | Discord config (token masked) |
| POST | `/api/integrations/discord` | Save Discord bot token |
| POST | `/api/integrations/discord/test` | Test Discord connection |
| GET | `/api/integrations/discord/guilds` | List Discord guilds |
| GET | `/api/integrations/discord/channels?guildId=X` | List Discord text channels |
| GET | `/api/sources` | List all data sources with entry counts |
| GET | `/api/sources/:id/entries` | Paginated entries for a source |
| GET | `/api/source-entries` | All entries across sources (feed view) |
