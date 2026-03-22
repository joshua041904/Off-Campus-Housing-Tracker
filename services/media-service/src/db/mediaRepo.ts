import pg from 'pg'

const { Pool } = pg

/** Media DB is 5448 in docker-compose / external Postgres. In K8s use POSTGRES_URL_MEDIA or DATABASE_HOST + MEDIA_DB_PORT (see app-config). */
const mediaPort = process.env.MEDIA_DB_PORT || process.env.PG_PORT || '5448'
const mediaDb = process.env.MEDIA_DB_NAME || process.env.PG_DATABASE || 'media'
const conn =
  process.env.POSTGRES_URL_MEDIA ||
  (process.env.DATABASE_HOST
    ? `postgresql://${process.env.PG_USER || 'postgres'}:${process.env.PG_PASSWORD || 'postgres'}@${process.env.DATABASE_HOST}:${mediaPort}/${mediaDb}?connect_timeout=10`
    : `postgresql://postgres:postgres@127.0.0.1:${mediaPort}/${mediaDb}?connect_timeout=10`)

export const pool = new Pool({
  connectionString: conn,
  max: 10,
  connectionTimeoutMillis: 10_000,
})

export interface MediaRow {
  id: string
  user_id: string
  object_key: string
  filename: string
  content_type: string
  size_bytes: number
  status: 'pending' | 'uploaded' | 'failed'
  created_at: Date
  updated_at: Date
}

export async function insertPending(
  id: string,
  userId: string,
  objectKey: string,
  filename: string,
  contentType: string,
  sizeBytes: number
): Promise<void> {
  await pool.query(
    `INSERT INTO media.media_files (id, user_id, object_key, filename, content_type, size_bytes, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, userId, objectKey, filename, contentType, sizeBytes]
  )
}

export async function setUploaded(id: string, client?: pg.PoolClient): Promise<void> {
  const q = client || pool
  await q.query(
    `UPDATE media.media_files SET status = 'uploaded', updated_at = now() WHERE id = $1`,
    [id]
  )
}

export async function getById(id: string): Promise<MediaRow | null> {
  const r = await pool.query(
    `SELECT id, user_id, object_key, filename, content_type, size_bytes, status, created_at, updated_at
     FROM media.media_files WHERE id = $1`,
    [id]
  )
  if (r.rows.length === 0) return null
  const row = r.rows[0]
  return {
    id: row.id,
    user_id: row.user_id,
    object_key: row.object_key,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function checkConnection(): Promise<boolean> {
  try {
    const r = await pool.query('SELECT 1')
    return r.rowCount === 1
  } catch {
    return false
  }
}
