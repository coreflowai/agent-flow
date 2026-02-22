import { getDb } from './index'
import { sandboxSessions } from './schema'
import { eq, desc } from 'drizzle-orm'
import type { SandboxSessionStatus } from '../sandbox/types'

export type SandboxSessionRecord = {
  id: string
  sandboxId: string
  providerId: string
  agentFlowSessionId: string
  status: SandboxSessionStatus
  config: Record<string, unknown>
  label: string | null
  snapshotId: string | null
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
}

function rowToRecord(row: any): SandboxSessionRecord {
  return {
    id: row.id,
    sandboxId: row.sandboxId,
    providerId: row.providerId,
    agentFlowSessionId: row.agentFlowSessionId,
    status: row.status as SandboxSessionStatus,
    config: (row.config as Record<string, unknown>) ?? {},
    label: row.label ?? null,
    snapshotId: row.snapshotId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }
}

export function addSandboxSession(input: {
  id: string
  sandboxId: string
  providerId: string
  agentFlowSessionId: string
  status?: SandboxSessionStatus
  config?: Record<string, unknown>
  label?: string
  metadata?: Record<string, unknown>
}): SandboxSessionRecord {
  const db = getDb()
  const now = Date.now()
  db.insert(sandboxSessions).values({
    id: input.id,
    sandboxId: input.sandboxId,
    providerId: input.providerId,
    agentFlowSessionId: input.agentFlowSessionId,
    status: input.status ?? 'creating',
    config: input.config ?? {},
    label: input.label ?? null,
    snapshotId: null,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {},
  }).run()
  return getSandboxSession(input.id)!
}

export function getSandboxSession(id: string): SandboxSessionRecord | null {
  const db = getDb()
  const row = db.select().from(sandboxSessions).where(eq(sandboxSessions.id, id)).get()
  return row ? rowToRecord(row) : null
}

export function getSandboxSessionByAfSession(agentFlowSessionId: string): SandboxSessionRecord | null {
  const db = getDb()
  const row = db.select().from(sandboxSessions).where(eq(sandboxSessions.agentFlowSessionId, agentFlowSessionId)).get()
  return row ? rowToRecord(row) : null
}

export function listSandboxSessions(): SandboxSessionRecord[] {
  const db = getDb()
  const rows = db.select().from(sandboxSessions).orderBy(desc(sandboxSessions.createdAt)).all()
  return rows.map(rowToRecord)
}

export function updateSandboxSessionStatus(id: string, status: SandboxSessionStatus, extra?: {
  snapshotId?: string
  metadata?: Record<string, unknown>
}): SandboxSessionRecord | null {
  const db = getDb()
  const updates: Record<string, unknown> = { status, updatedAt: Date.now() }
  if (extra?.snapshotId !== undefined) updates.snapshotId = extra.snapshotId
  if (extra?.metadata !== undefined) updates.metadata = extra.metadata
  db.update(sandboxSessions).set(updates).where(eq(sandboxSessions.id, id)).run()
  return getSandboxSession(id)
}

export function deleteSandboxSession(id: string) {
  const db = getDb()
  db.delete(sandboxSessions).where(eq(sandboxSessions.id, id)).run()
}
