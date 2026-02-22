#!/usr/bin/env bun
/**
 * Backfill script: embed all existing source entries into the vector store.
 *
 * Usage:
 *   VOYAGE_API_KEY=... bun run scripts/backfill-vectors.ts
 *
 * Env vars:
 *   SOURCES_DB     - path to sources.db (default: ./sources.db)
 *   VECTORS_DB     - path to vectors.db (default: ./vectors.db)
 *   VOYAGE_API_KEY - required for embeddings
 */
import { Database } from 'bun:sqlite'
import { initVectorStore, embedAndStoreBatch, closeVectorStore } from '../src/db/vectors'
import { isEmbeddingConfigured } from '../src/db/embeddings'

const BATCH_SIZE = 128

async function main() {
  if (!isEmbeddingConfigured()) {
    console.error('VOYAGE_API_KEY is not set. Aborting.')
    process.exit(1)
  }

  const sourcesDbPath = process.env.SOURCES_DB ?? './sources.db'
  const vectorsDbPath = process.env.VECTORS_DB ?? './vectors.db'

  console.log(`[Backfill] Sources DB: ${sourcesDbPath}`)
  console.log(`[Backfill] Vectors DB: ${vectorsDbPath}`)

  // Open sources.db read-only
  const db = new Database(sourcesDbPath, { readonly: true })
  const { count: total } = db.prepare('SELECT COUNT(*) as count FROM source_entries').get() as { count: number }
  console.log(`[Backfill] Found ${total} source entries to embed`)

  if (total === 0) {
    console.log('[Backfill] Nothing to do.')
    db.close()
    return
  }

  // Initialize vector store
  const ok = await initVectorStore(vectorsDbPath)
  if (!ok) {
    console.error('[Backfill] Failed to initialize vector store. Aborting.')
    db.close()
    process.exit(1)
  }

  let processed = 0
  const startTime = Date.now()

  // Process in batches
  const stmt = db.prepare('SELECT id, data_source_id, author, content, timestamp FROM source_entries ORDER BY timestamp ASC LIMIT ? OFFSET ?')

  while (processed < total) {
    const rows = stmt.all(BATCH_SIZE, processed) as Array<{
      id: string
      data_source_id: string
      author: string | null
      content: string | null
      timestamp: number
    }>

    if (rows.length === 0) break

    const entries = rows
      .filter(r => r.content) // skip entries with no content
      .map(r => ({
        id: r.id,
        content: r.content!,
        author: r.author,
        dataSourceId: r.data_source_id,
        timestamp: r.timestamp,
      }))

    if (entries.length > 0) {
      const embedded = await embedAndStoreBatch(entries)
      processed += rows.length
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[Backfill] ${processed}/${total} entries processed (${embedded} embedded, ${elapsed}s elapsed)`)
    } else {
      processed += rows.length
    }
  }

  closeVectorStore()
  db.close()

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`[Backfill] Done! ${processed} entries processed in ${totalTime}s`)
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err)
  process.exit(1)
})
