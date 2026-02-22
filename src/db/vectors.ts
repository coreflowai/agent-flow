import { Database } from 'bun:sqlite'
import { getEmbeddings, isEmbeddingConfigured, prepareText } from './embeddings'

export type SearchResult = {
  id: string
  content: string
  author: string | null
  dataSourceId: string
  timestamp: number
  score: number
}

let _db: Database | null = null

/**
 * Initialize the vector store backed by SQLite.
 * Embeddings are stored as raw Float32Array BLOBs.
 */
export async function initVectorStore(dbPath: string): Promise<boolean> {
  if (_db) return true

  try {
    _db = new Database(dbPath, { create: true })
    _db.exec('PRAGMA journal_mode=WAL')
    _db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        data_source_id TEXT NOT NULL,
        content TEXT,
        author TEXT,
        timestamp INTEGER NOT NULL,
        embedding BLOB NOT NULL
      )
    `)
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_ds ON embeddings(data_source_id)`)
    console.log(`[VectorStore] Initialized SQLite vector store at ${dbPath}`)
    return true
  } catch (err) {
    console.warn('[VectorStore] Failed to initialize:', err)
    return false
  }
}

/**
 * Close the vector store.
 */
export function closeVectorStore(): void {
  if (_db) {
    try { _db.close() } catch {}
    _db = null
  }
}

/**
 * Cosine similarity between two Float32Arrays.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Convert number[] to BLOB for storage.
 */
function toBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer)
}

/**
 * Embed a source entry and store it.
 * No-op if embeddings are not configured or vector store not initialized.
 */
export async function embedAndStore(entry: {
  id: string
  content: string
  author?: string | null
  dataSourceId: string
  timestamp: number
}): Promise<void> {
  if (!_db || !isEmbeddingConfigured()) return

  const text = prepareText(entry.content, entry.author)
  const embeddings = await getEmbeddings([text])
  if (embeddings.length === 0) return

  _db.run(
    `INSERT OR REPLACE INTO embeddings (id, data_source_id, content, author, timestamp, embedding)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.dataSourceId, entry.content, entry.author ?? '', entry.timestamp, toBlob(embeddings[0])]
  )
}

/**
 * Embed multiple entries and store them in batch.
 * Used by the backfill script.
 */
export async function embedAndStoreBatch(entries: Array<{
  id: string
  content: string
  author?: string | null
  dataSourceId: string
  timestamp: number
}>): Promise<number> {
  if (!_db || !isEmbeddingConfigured() || entries.length === 0) return 0

  const texts = entries.map(e => prepareText(e.content, e.author))
  const embeddings = await getEmbeddings(texts)
  if (embeddings.length === 0) return 0

  const stmt = _db.prepare(
    `INSERT OR REPLACE INTO embeddings (id, data_source_id, content, author, timestamp, embedding)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const tx = _db.transaction(() => {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      stmt.run(e.id, e.dataSourceId, e.content, e.author ?? '', e.timestamp, toBlob(embeddings[i]))
    }
  })
  tx()
  return entries.length
}

/**
 * Search for semantically similar entries via brute-force cosine similarity.
 * Returns empty array if not configured.
 */
export async function semanticSearch(
  query: string,
  opts?: { topk?: number; dataSourceId?: string }
): Promise<SearchResult[]> {
  if (!_db || !isEmbeddingConfigured()) return []

  const topk = Math.min(opts?.topk ?? 10, 50)
  const embeddings = await getEmbeddings([query])
  if (embeddings.length === 0) return []

  const queryVec = new Float32Array(embeddings[0])

  // Load candidate embeddings from SQLite
  let sql = 'SELECT id, data_source_id, content, author, timestamp, embedding FROM embeddings'
  const params: unknown[] = []
  if (opts?.dataSourceId) {
    sql += ' WHERE data_source_id = ?'
    params.push(opts.dataSourceId)
  }

  const rows = _db.prepare(sql).all(...params) as Array<{
    id: string
    data_source_id: string
    content: string
    author: string
    timestamp: number
    embedding: Buffer
  }>

  // Score each row
  const scored = rows.map(row => {
    const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
    return {
      id: row.id,
      content: row.content ?? '',
      author: row.author || null,
      dataSourceId: row.data_source_id,
      timestamp: row.timestamp,
      score: cosineSimilarity(queryVec, vec),
    }
  })

  // Sort by similarity descending, take topk
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topk)
}

/**
 * Delete all vectors for a given data source.
 */
export function deleteFromVectorStore(dataSourceId: string): void {
  if (!_db) return
  try {
    _db.run('DELETE FROM embeddings WHERE data_source_id = ?', [dataSourceId])
  } catch (err) {
    console.error('[VectorStore] Delete error:', err)
  }
}
