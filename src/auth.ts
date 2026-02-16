import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db"
import { apiKey } from "better-auth/plugins"
import { getSqlite } from "./db"

const ALLOWED_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS
  ?.split(",").map(d => d.trim().toLowerCase()).filter(Boolean) ?? []

function isEmailAllowed(email: string): boolean {
  if (ALLOWED_DOMAINS.length === 0) return true
  const domain = email.split("@")[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain!)
}

function getAuthConfig(options?: { baseURL?: string; disableSignUp?: boolean }) {
  const sqlite = getSqlite()
  return {
    database: sqlite,
    basePath: "/api/auth",
    baseURL: options?.baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: options?.disableSignUp ?? true, // sign-up disabled by default, use CLI to create users
      async onSignUp({ email }: { email: string }) {
        if (!isEmailAllowed(email)) {
          throw new Error("Email domain not allowed")
        }
      },
    },
    plugins: [
      apiKey({
        defaultPrefix: "agentflow_",
        enableMetadata: true,
      }),
    ],
  } as const
}

export async function migrateAuth(options?: { baseURL?: string; disableSignUp?: boolean }) {
  const config = getAuthConfig(options)
  const { runMigrations } = await getMigrations(config)
  await runMigrations()
}

export function createAuth(options?: { baseURL?: string; disableSignUp?: boolean }) {
  return betterAuth(getAuthConfig(options))
}

export type Auth = ReturnType<typeof createAuth>

// Cache verified API keys for 5 minutes to avoid rate limits
const apiKeyCache = new Map<string, { userId: string; expiresAt: number }>()
const API_KEY_CACHE_TTL = 5 * 60 * 1000

export async function authenticateRequest(req: Request, auth: Auth): Promise<{ authenticated: boolean; userId?: string }> {
  // 1. Check x-api-key header
  const apiKeyHeader = req.headers.get("x-api-key")
  if (apiKeyHeader) {
    // Check cache first
    const cached = apiKeyCache.get(apiKeyHeader)
    if (cached && cached.expiresAt > Date.now()) {
      return { authenticated: true, userId: cached.userId }
    }
    try {
      const result = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } })
      if (result.valid && result.key) {
        apiKeyCache.set(apiKeyHeader, { userId: result.key.userId, expiresAt: Date.now() + API_KEY_CACHE_TTL })
        return { authenticated: true, userId: result.key.userId }
      }
    } catch {}
    return { authenticated: false }
  }

  // 2. Check session cookie
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (session?.user) {
      return { authenticated: true, userId: session.user.id }
    }
  } catch {}

  return { authenticated: false }
}
