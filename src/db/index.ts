import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq, desc, sql } from 'drizzle-orm'
import { sessions, events, invites } from './schema'
import type { AgentFlowEvent, Session, UserInfo } from '../types'

const DB_PATH = process.env.AGENT_FLOW_DB ?? 'agent-flow.db'

let _db: ReturnType<typeof createDb> | null = null

function createDb(dbPath: string = DB_PATH) {
  const sqlite = new Database(dbPath)
  sqlite.run('PRAGMA journal_mode = WAL')
  const db = drizzle(sqlite)

  migrate(db, { migrationsFolder: './drizzle' })

  return { db, sqlite }
}

export function getDb(dbPath?: string) {
  if (!_db) {
    _db = createDb(dbPath)
  }
  return _db.db
}

export function getSqlite(dbPath?: string) {
  if (!_db) {
    _db = createDb(dbPath)
  }
  return _db.sqlite
}

export function closeDb() {
  if (_db) {
    _db.sqlite.close()
    _db = null
  }
}

export function initDb(dbPath?: string) {
  return getDb(dbPath)
}

export function addEvent(event: AgentFlowEvent) {
  const db = getDb()
  const now = event.timestamp

  // Upsert session
  const existing = db.select().from(sessions).where(eq(sessions.id, event.sessionId)).get()
  if (!existing) {
    db.insert(sessions).values({
      id: event.sessionId,
      source: event.source,
      startTime: now,
      lastEventTime: now,
      status: 'active',
      metadata: {},
    }).run()
  } else {
    db.update(sessions)
      .set({ lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  }

  // Update session status based on event
  if (event.type === 'session.end') {
    db.update(sessions)
      .set({ status: 'completed', lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  } else if (event.category === 'error') {
    db.update(sessions)
      .set({ status: 'error', lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  } else if (existing && existing.status === 'completed') {
    // Reactivate if new events come in after completion
    db.update(sessions)
      .set({ status: 'active', lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  }

  // Insert event
  db.insert(events).values({
    id: event.id,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    source: event.source,
    category: event.category,
    type: event.type,
    role: event.role,
    text: event.text,
    toolName: event.toolName,
    toolInput: event.toolInput as any,
    toolOutput: event.toolOutput as any,
    error: event.error,
    meta: event.meta as any,
  }).run()
}

const STALE_TIMEOUT = 7 * 24 * 60 * 60 * 1000 // 7 days

function deriveEventText(event: { type: string; text: string | null; toolName: string | null; error: string | null } | undefined): string | null {
  if (!event) return null
  if (event.toolName) return event.toolName
  if (event.text) return event.text
  if (event.error) return event.error
  return null
}

function deriveStatus(status: string, lastEventTime: number): Session['status'] {
  if (status === 'error') return 'error'
  if (status === 'completed') return 'completed'
  // Auto-complete active sessions after inactivity
  if (Date.now() - lastEventTime > STALE_TIMEOUT) return 'completed'
  return 'active'
}

export function getSession(id: string): Session | null {
  const db = getDb()
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return null

  const [countResult] = db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.sessionId, id))
    .all()

  const lastEvent = db.select({ type: events.type, text: events.text, toolName: events.toolName, error: events.error })
    .from(events)
    .where(eq(events.sessionId, id))
    .orderBy(desc(events.timestamp))
    .limit(1)
    .get()

  return {
    id: row.id,
    source: row.source as Session['source'],
    startTime: row.startTime,
    lastEventTime: row.lastEventTime,
    status: deriveStatus(row.status!, row.lastEventTime),
    lastEventType: lastEvent?.type ?? null,
    lastEventText: deriveEventText(lastEvent),
    eventCount: countResult.count,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    userId: row.userId ?? null,
  }
}

export function getSessionEvents(sessionId: string): AgentFlowEvent[] {
  const db = getDb()
  return db.select().from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.timestamp)
    .all()
    .map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      timestamp: row.timestamp,
      source: row.source as AgentFlowEvent['source'],
      category: row.category as AgentFlowEvent['category'],
      type: row.type,
      role: row.role as AgentFlowEvent['role'],
      text: row.text,
      toolName: row.toolName,
      toolInput: row.toolInput,
      toolOutput: row.toolOutput,
      error: row.error,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    }))
}

export function listSessions(userId?: string): Session[] {
  const db = getDb()
  const query = userId
    ? db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastEventTime))
    : db.select().from(sessions).orderBy(desc(sessions.lastEventTime))
  const rows = query.all()

  return rows.map(row => {
    const [countResult] = db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.sessionId, row.id))
      .all()

    const lastEvent = db.select({ type: events.type, text: events.text, toolName: events.toolName, error: events.error })
      .from(events)
      .where(eq(events.sessionId, row.id))
      .orderBy(desc(events.timestamp))
      .limit(1)
      .get()

    return {
      id: row.id,
      source: row.source as Session['source'],
      startTime: row.startTime,
      lastEventTime: row.lastEventTime,
      status: deriveStatus(row.status!, row.lastEventTime),
      lastEventType: lastEvent?.type ?? null,
      lastEventText: deriveEventText(lastEvent),
      eventCount: countResult.count,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      userId: row.userId ?? null,
    }
  })
}

export function updateSessionUserId(id: string, userId: string) {
  const db = getDb()
  const row = db.select({ userId: sessions.userId }).from(sessions).where(eq(sessions.id, id)).get()
  if (!row || row.userId) return // only set if not already set
  db.update(sessions)
    .set({ userId })
    .where(eq(sessions.id, id))
    .run()
}

export function updateSessionMeta(id: string, meta: Record<string, unknown>) {
  const db = getDb()
  const row = db.select({ metadata: sessions.metadata }).from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return
  const existing = (row.metadata ?? {}) as Record<string, unknown>
  db.update(sessions)
    .set({ metadata: { ...existing, ...meta } })
    .where(eq(sessions.id, id))
    .run()
}

export function deleteSession(id: string) {
  const db = getDb()
  db.delete(events).where(eq(events.sessionId, id)).run()
  db.delete(sessions).where(eq(sessions.id, id)).run()
}

export function clearAll() {
  const db = getDb()
  db.delete(events).run()
  db.delete(sessions).run()
}

// --- Invites ---

const INVITE_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days

export function createInvite(createdBy: string, email?: string): { id: string; token: string } {
  const db = getDb()
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, '')
  const now = Date.now()
  db.insert(invites).values({
    id,
    token,
    email: email || null,
    createdBy,
    createdAt: now,
    expiresAt: now + INVITE_EXPIRY,
  }).run()
  return { id, token }
}

export function getInviteByToken(token: string) {
  const db = getDb()
  return db.select().from(invites).where(eq(invites.token, token)).get() ?? null
}

export function listInvites() {
  const db = getDb()
  return db.select().from(invites).orderBy(desc(invites.createdAt)).all()
}

export function markInviteUsed(id: string, usedBy: string) {
  const db = getDb()
  db.update(invites)
    .set({ usedAt: Date.now(), usedBy })
    .where(eq(invites.id, id))
    .run()
}

export function deleteInvite(id: string) {
  const db = getDb()
  db.delete(invites).where(eq(invites.id, id)).run()
}
