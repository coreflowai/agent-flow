import { Server as Engine } from '@socket.io/bun-engine'
import { Server as SocketIOServer } from 'socket.io'
import { initDb, listSessions, getSessionEvents } from './db'
import { createRouter } from './routes'
import path from 'path'

type ServerOptions = {
  port?: number
  dbPath?: string
  serveStatic?: boolean
}

export function createServer(options: ServerOptions = {}) {
  const { port = 3333, dbPath, serveStatic = true } = options

  initDb(dbPath)

  const io = new SocketIOServer()
  const engine = new Engine({ path: '/socket.io/' })
  io.bind(engine)

  const router = createRouter(io)
  const engineHandler = engine.handler()
  const publicDir = path.join(import.meta.dir, '..', 'public')

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    socket.emit('sessions:list', listSessions())

    socket.on('subscribe', (sessionId: string) => {
      socket.join(`session:${sessionId}`)
      const events = getSessionEvents(sessionId)
      socket.emit('session:events', { sessionId, events })
    })

    socket.on('unsubscribe', (sessionId: string) => {
      socket.leave(`session:${sessionId}`)
    })
  })

  const server = Bun.serve({
    port,
    idleTimeout: 30,
    async fetch(req, server) {
      // Route Socket.IO requests to the engine
      const url = new URL(req.url)
      if (url.pathname.startsWith('/socket.io/')) {
        return engine.handleRequest(req, server)
      }

      // Try API routes
      const apiResponse = await router(req)
      if (apiResponse) return apiResponse

      // Static file serving
      if (serveStatic) {
        const filePath = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname)

        if (filePath.startsWith(publicDir)) {
          try {
            const file = Bun.file(filePath)
            if (await file.exists()) {
              return new Response(file, {
                headers: { 'Cache-Control': 'no-cache' },
              })
            }
          } catch {}

          // Fallback to index.html
          const indexFile = Bun.file(path.join(publicDir, 'index.html'))
          if (await indexFile.exists()) {
            return new Response(indexFile, { headers: { 'Content-Type': 'text/html' } })
          }
        }
      }

      return new Response('Not Found', { status: 404 })
    },
    websocket: engineHandler.websocket,
  })

  return {
    server,
    io,
    url: `http://localhost:${server.port}`,
    close: () => {
      io.close()
      server.stop(true)
    },
  }
}
