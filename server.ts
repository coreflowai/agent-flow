import { createServer } from './src/server-factory'

// Prevent uncaught errors from crashing the process (e.g. Slack SDK internals)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message || err)
})
process.on('unhandledRejection', (err: any) => {
  console.error('[unhandledRejection]', err?.message || err)
})

const PORT = parseInt(process.env.PORT ?? '3333', 10)
const DB_PATH = process.env.AGENT_FLOW_DB ?? 'agent-flow.db'

if (!process.env.BETTER_AUTH_SECRET) {
  console.warn('WARNING: BETTER_AUTH_SECRET is not set. Auth will not work properly in production.')
}

const { server, io, url, auth } = createServer({
  port: PORT,
  dbPath: DB_PATH,
  serveStatic: true,
})

console.log(`AgentFlow running at ${url}`)

// Seed user from env vars (e.g. SEED_USER_EMAIL + SEED_USER_PASSWORD)
if (process.env.SEED_USER_EMAIL && process.env.SEED_USER_PASSWORD && auth) {
  const { createAuth } = await import('./src/auth')
  const seedAuth = createAuth({ disableSignUp: false })
  seedAuth.api.signUpEmail({
    body: {
      email: process.env.SEED_USER_EMAIL,
      password: process.env.SEED_USER_PASSWORD,
      name: process.env.SEED_USER_NAME || process.env.SEED_USER_EMAIL.split('@')[0],
    },
  }).then(() => {
    console.log(`Seeded user: ${process.env.SEED_USER_EMAIL}`)
  }).catch(() => {
    // User likely already exists — ignore
  })
}

export { server, io }
