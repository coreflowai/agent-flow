import { Server as Engine } from '@socket.io/bun-engine'
import { Server as SocketIOServer } from 'socket.io'
import { EventEmitter } from 'events'
import { initDb, listSessions, getSessionEventCount } from './db'
import { createRouter } from './routes'
import { createAuth, migrateAuth, authenticateRequest, type Auth } from './auth'
import { createInsightScheduler, type InsightScheduler, createCuriosityScheduler, type CuriosityScheduler } from './insights'
import { createSlackBot, type SlackBot } from './slack'
import { getIntegrationConfig } from './db/slack'
import { initSourcesDb } from './db/sources'
import { createSourceManager, type SourceManager } from './sources'
import path from 'path'
import { execSync } from 'child_process'

const GIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim() }
  catch { return Date.now().toString(36) }
})()

type ServerOptions = {
  port?: number
  dbPath?: string
  serveStatic?: boolean
  authEnabled?: boolean
  /** Enable insight analysis scheduler (default: true in production) */
  insightsEnabled?: boolean
  /** Run insight analysis immediately on start (default: false) */
  insightsRunOnStart?: boolean
  /** Enable Slack bot integration (default: check env/db config) */
  slackEnabled?: boolean
}

// Files accessible without authentication
const PUBLIC_FILES = new Set(['/login.html', '/auth-client.js', '/invite.html', '/invite-client.js', '/llms.txt'])

export function createServer(options: ServerOptions = {}) {
  const {
    port = 3333,
    dbPath,
    serveStatic = true,
    authEnabled = true,
    insightsEnabled = process.env.NODE_ENV === 'production',
    insightsRunOnStart = false,
    slackEnabled,
  } = options

  const resolvedDbPath = dbPath ?? process.env.AGENT_FLOW_DB ?? 'agent-flow.db'
  initDb(resolvedDbPath)

  // Initialize separate sources DB for external context data
  const sourcesDbPath = process.env.SOURCES_DB ?? 'sources.db'
  initSourcesDb(sourcesDbPath)

  let auth: Auth | null = null
  let authReady: Promise<void> | null = null

  if (authEnabled) {
    const baseURL = process.env.BETTER_AUTH_URL || `http://localhost:${port}`
    auth = createAuth({ baseURL })
    authReady = migrateAuth({ baseURL }).catch(err => {
      console.error('Better Auth migration failed:', err)
    })
  }

  const io = new SocketIOServer()
  const engine = new Engine({ path: '/socket.io/' })
  io.bind(engine)

  const engineHandler = engine.handler()
  const publicDir = path.join(import.meta.dir, '..', 'public')

  // Socket.IO auth middleware
  if (authEnabled && auth) {
    const authRef = auth
    io.use(async (socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie
        if (!cookieHeader) return next(new Error('Authentication required'))
        const headers = new Headers({ cookie: cookieHeader })
        const session = await authRef.api.getSession({ headers })
        if (session?.user) {
          ;(socket.data as any).userId = session.user.id
          return next()
        }
        next(new Error('Authentication required'))
      } catch {
        next(new Error('Authentication required'))
      }
    })
  }

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    socket.emit('sessions:list', listSessions())

    socket.on('subscribe', (sessionId: string) => {
      socket.join(`session:${sessionId}`)
      const totalEvents = getSessionEventCount(sessionId)
      socket.emit('session:meta', { sessionId, totalEvents })
    })

    socket.on('unsubscribe', (sessionId: string) => {
      socket.leave(`session:${sessionId}`)
    })
  })

  // Internal event bus for cross-component communication
  const internalBus = new EventEmitter()

  // Insight analysis scheduler
  let insightScheduler: InsightScheduler | null = null

  // Curiosity scheduler (proactive questions)
  let curiosityScheduler: CuriosityScheduler | null = null

  // Slack bot integration
  let slackBot: SlackBot | null = null

  function getSlackConfig(): { botToken: string; appToken: string; channel: string; adminUserId?: string } | null {
    // Check DB config first, then fall back to env vars
    const dbConfig = getIntegrationConfig('slack')
    if (dbConfig) {
      const c = dbConfig.config as Record<string, string>
      if (c.botToken && c.appToken) return { botToken: c.botToken, appToken: c.appToken, channel: c.channel || '', adminUserId: c.adminUserId || process.env.SLACK_ADMIN_USER_ID }
    }
    const botToken = process.env.SLACK_BOT_TOKEN
    const appToken = process.env.SLACK_APP_TOKEN
    if (botToken && appToken) {
      return { botToken, appToken, channel: process.env.SLACK_CHANNEL || '', adminUserId: process.env.SLACK_ADMIN_USER_ID }
    }
    return null
  }

  async function startSlackBot(config: { botToken: string; appToken: string; channel: string; adminUserId?: string }) {
    if (slackBot) {
      try { await slackBot.stop() } catch {}
    }
    slackBot = createSlackBot({ ...config, io, internalBus, dbPath: resolvedDbPath, sourcesDbPath })
    try {
      await slackBot.start()
    } catch (err) {
      console.error('Failed to start Slack bot:', err)
      slackBot = null
    }
  }

  async function restartSlackBot(config: { botToken: string; appToken: string; channel: string; adminUserId?: string }) {
    await startSlackBot(config)
  }

  // Determine if Slack should be enabled
  const shouldEnableSlack = slackEnabled ?? (process.env.SLACK_ENABLED === 'true' || !!getSlackConfig())
  if (shouldEnableSlack) {
    const config = getSlackConfig()
    if (config) {
      startSlackBot(config).catch(err => console.error('Slack bot startup error:', err))
    }
  }

  const slackBotRef = {
    get bot() { return slackBot },
    restart: restartSlackBot,
  }

  // Source manager for external context (Slack channels, Discord, RSS feeds)
  // Use a proxy for slackBot deps so listeners can access whichever bot is active
  const sourceManager = createSourceManager({
    io,
    deps: {
      slackBot: {
        registerChannelListener(channelId: string, cb: (msg: any) => void) {
          slackBot?.registerChannelListener(channelId, cb)
        },
        unregisterChannelListener(channelId: string) {
          slackBot?.unregisterChannelListener(channelId)
        },
      },
    },
  })

  const router = createRouter(io, slackBotRef, internalBus, sourceManager)

  // Create insight scheduler after slackBotRef is set up
  if (insightsEnabled) {
    insightScheduler = createInsightScheduler({
      io,
      dbPath: resolvedDbPath,
      sourcesDbPath,
      runOnStart: insightsRunOnStart,
      slackBot: slackBotRef,
      internalBus,
    })

    curiosityScheduler = createCuriosityScheduler({
      io,
      dbPath: resolvedDbPath,
      sourcesDbPath,
      slackBot: slackBotRef,
      internalBus,
    })
  }

  // Start source listeners from DB state
  sourceManager.start().catch(err => console.error('SourceManager startup error:', err))

  function serveHtml(filePath: string) {
    const file = Bun.file(filePath)
    return file.exists().then(async exists => {
      if (!exists) return null
      let html = await file.text()
      html = html.replace(/(src|href)="(\/[^"]+\.(js|css))(\?[^"]*)?"/g, `$1="$2?v=${GIT_HASH}"`)
      return new Response(html, {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
      })
    })
  }

  const server = Bun.serve({
    port,
    idleTimeout: 30,
    async fetch(req, server) {
      // Wait for auth migrations on first request
      if (authReady) {
        await authReady
        authReady = null
      }

      const url = new URL(req.url)

      // Health check — public, no auth
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Route Socket.IO requests to the engine
      if (url.pathname.startsWith('/socket.io/')) {
        return engine.handleRequest(req, server)
      }

      // Route Better Auth requests
      if (auth && url.pathname.startsWith('/api/auth')) {
        return auth.handler(req)
      }

      // API routes — require auth (with exceptions for public invite endpoints)
      if (url.pathname.startsWith('/api/')) {
        const isPublicInviteRoute =
          (req.method === 'GET' && url.pathname === '/api/invites/check') ||
          (req.method === 'POST' && url.pathname === '/api/invites/redeem')

        let userId: string | undefined
        if (auth && !isPublicInviteRoute) {
          const result = await authenticateRequest(req, auth)
          if (!result.authenticated) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          userId = result.userId
        }
        const apiResponse = await router(req, userId)
        if (apiResponse) return apiResponse
      }

      // Setup route (non-API, no /api/ prefix) — require auth
      if (url.pathname === '/setup/hook.sh' || url.pathname === '/setup/opencode-plugin.ts') {
        if (auth) {
          const result = await authenticateRequest(req, auth)
          if (!result.authenticated) {
            return new Response('Unauthorized', { status: 401 })
          }
        }
        const apiResponse = await router(req)
        if (apiResponse) return apiResponse
      }

      // Static file serving
      if (serveStatic) {
        const isIndex = url.pathname === '/'
        const filePath = path.join(publicDir, isIndex ? 'index.html' : url.pathname)

        if (filePath.startsWith(publicDir)) {
          // Public files (login page, auth client) — no auth required
          if (PUBLIC_FILES.has(url.pathname)) {
            try {
              const file = Bun.file(filePath)
              if (await file.exists()) {
                if (filePath.endsWith('.html')) {
                  return (await serveHtml(filePath))!
                }
                return new Response(file, {
                  headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                })
              }
            } catch {}
          }

          // Protected static files — redirect to login if no session
          if (auth) {
            const { authenticated } = await authenticateRequest(req, auth)
            if (!authenticated) {
              return Response.redirect(new URL('/login.html', req.url).toString(), 302)
            }
          }

          try {
            const file = Bun.file(filePath)
            if (await file.exists()) {
              if (filePath.endsWith('.html')) {
                return (await serveHtml(filePath))!
              }
              return new Response(file, {
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
              })
            }
          } catch {}

          // Fallback to index.html (SPA)
          const resp = await serveHtml(path.join(publicDir, 'index.html'))
          if (resp) return resp
        }
      }

      return new Response('Not Found', { status: 404 })
    },
    websocket: engineHandler.websocket,
  })

  return {
    server,
    io,
    auth,
    insightScheduler,
    slackBot: slackBotRef,
    url: `http://localhost:${server.port}`,
    close: async () => {
      insightScheduler?.stop()
      curiosityScheduler?.stop()
      await sourceManager.stop()
      if (slackBot) {
        try { await slackBot.stop() } catch {}
      }
      io.close()
      server.stop(true)
    },
  }
}
