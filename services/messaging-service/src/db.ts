/**
 * Direct Postgres access for messaging-service. Prepared statements only (no Prisma).
 * Prevents SQL injection; all user input is parameterized.
 */
import { randomUUID } from 'node:crypto'
import { Pool, PoolClient } from 'pg'

const host = process.env.MESSAGING_DB_HOST || process.env.PGHOST || '127.0.0.1'
const port = parseInt(process.env.MESSAGING_DB_PORT || process.env.PGPORT || '5444', 10)
const user = process.env.PGUSER || 'postgres'
const password = process.env.PGPASSWORD || 'postgres'
const database = process.env.MESSAGING_DB_NAME || 'messaging'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export interface MessageRow {
  id: string
  conversation_id: string
  sender_id: string
  body: string | null
  message_type: string
  created_at: Date
  media_id: string | null
}

/** Insert message and outbox row in one transaction; returns message id and sent_at. */
export async function insertMessageAndOutbox(
  client: PoolClient,
  conversationId: string,
  senderId: string,
  content: string,
  mediaId: string | null
): Promise<{ messageId: string; sentAt: string }> {
  const messageId = randomUUID()
  const outboxId = randomUUID()
  await client.query(
    `INSERT INTO messaging.messages (id, conversation_id, sender_id, body, message_type, media_id)
     VALUES ($1, $2, $3, $4, 'text', $5)`,
    [messageId, conversationId, senderId, content, mediaId || null]
  )
  const payload = Buffer.from(
    JSON.stringify({
      message_id: messageId,
      conversation_id: conversationId,
      sender_id: senderId,
      sent_at: new Date().toISOString(),
      media_id: mediaId || undefined,
    })
  )
  await client.query(
    `INSERT INTO messaging.outbox_events (id, aggregate_id, type, version, payload, created_at, published)
     VALUES ($1, $2, 'MessageSentV1', 1, $3, now(), false)`,
    [outboxId, conversationId, payload]
  )
  const r = await client.query(
    `SELECT created_at FROM messaging.messages WHERE id = $1`,
    [messageId]
  )
  const sentAt = r.rows[0]?.created_at ? new Date(r.rows[0].created_at).toISOString() : new Date().toISOString()
  return { messageId, sentAt }
}

/** Get conversation messages with cursor pagination (before message_id, limit). */
export async function getConversationMessages(
  conversationId: string,
  limit: number,
  beforeMessageId: string | null
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const pool = getPool()
  const limitPlusOne = limit + 1
  let result
  if (beforeMessageId) {
    result = await pool.query(
    `SELECT id, conversation_id, sender_id, body, message_type, created_at, media_id
     FROM messaging.messages
     WHERE conversation_id = $1 AND deleted_at IS NULL AND created_at < (SELECT created_at FROM messaging.messages WHERE id = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
      [conversationId, beforeMessageId, limitPlusOne]
    )
  } else {
    result = await pool.query(
    `SELECT id, conversation_id, sender_id, body, message_type, created_at, media_id
     FROM messaging.messages
     WHERE conversation_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
      [conversationId, limitPlusOne]
    )
  }
  const rows = result.rows as MessageRow[]
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  return { messages, hasMore }
}

/** Mark conversation as read for user (optionally up to message_id). */
export async function markAsRead(
  conversationId: string,
  userId: string,
  messageId: string | null
): Promise<boolean> {
  const pool = getPool()
  if (messageId) {
    const r = await pool.query(
      `UPDATE messaging.conversation_participants
       SET last_read_at = (SELECT created_at FROM messaging.messages WHERE id = $3 AND conversation_id = $1)
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING 1`,
      [conversationId, userId, messageId]
    )
    return (r.rowCount ?? 0) > 0
  } else {
    const r = await pool.query(
      `UPDATE messaging.conversation_participants
       SET last_read_at = now()
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING 1`,
      [conversationId, userId]
    )
    return (r.rowCount ?? 0) > 0
  }
}

/** Ensure conversation exists; create if missing. Returns conversation id. */
export async function ensureConversation(client: PoolClient, conversationId: string): Promise<void> {
  await client.query(
    `INSERT INTO messaging.conversations (id, created_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [conversationId]
  )
}
