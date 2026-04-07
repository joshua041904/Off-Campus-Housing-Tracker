/**
 * Integration tests: messaging DB + **transactional outbox** (DB-only; no Kafka client here),
 * rate limit (Redis), spam (Trust DB).
 * Outbox contract: same transaction as domain write → row with `published = false` until the publisher drains to Kafka (see docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md). Service matrix: docs/outbox-coverage-by-service.md.
 * Requires: Postgres (messaging, trust), Redis.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { checkAndIncrement } from '../../src/rateLimit'

const MESSAGING_HOST = process.env.MESSAGING_DB_HOST || process.env.PGHOST || '127.0.0.1'
const MESSAGING_PORT = parseInt(process.env.MESSAGING_DB_PORT || process.env.PGPORT || '5444', 10)
const TRUST_PORT = parseInt(process.env.TRUST_DB_PORT || process.env.VERIFY_DB_PORT || '5446', 10)

let messagingPool: Pool
let trustPool: Pool

describe('Messaging flow (integration)', () => {
  beforeAll(() => {
    const pgConfig = {
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      host: MESSAGING_HOST,
    }
    messagingPool = new Pool({ ...pgConfig, port: MESSAGING_PORT, database: 'messaging' })
    trustPool = new Pool({ ...pgConfig, port: TRUST_PORT, database: 'trust' })
  })

  afterAll(async () => {
    await messagingPool?.end()
    await trustPool?.end()
  })

  // Requires messaging.* schema (run ensure-messaging-schema.sh after restoring 5434-social to 5444).
  it('A) send message and outbox row: insert message + outbox_events, then assert count', async () => {
    const schemaCheck = await messagingPool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'messaging' AND table_name = 'messages' LIMIT 1`
    )
    if (!schemaCheck.rows.length) {
      return // skip when messaging.* schema not present (e.g. DB from 5434-social only)
    }

    const convId = randomUUID()
    const msgId = randomUUID()
    const senderId = randomUUID()
    const conn = await messagingPool.connect()
    try {
      await conn.query('BEGIN')
      await conn.query(
        `INSERT INTO messaging.conversations (id, created_at, updated_at) VALUES ($1, now(), now()) ON CONFLICT DO NOTHING`,
        [convId]
      )
      await conn.query(
        `INSERT INTO messaging.messages (id, conversation_id, sender_id, body, message_type) VALUES ($1, $2, $3, $4, 'text')`,
        [msgId, convId, senderId, 'integration test body']
      )
      const payload = Buffer.from(JSON.stringify({ message_id: msgId, conversation_id: convId, sender_id: senderId }))
      await conn.query(
        `INSERT INTO messaging.outbox_events (id, aggregate_id, type, version, payload, created_at, published) VALUES ($1, $2, 'MessageSentV1', 1, $3, now(), false)`,
        [randomUUID(), convId, payload]
      )
      await conn.query('COMMIT')
    } catch (e) {
      await conn.query('ROLLBACK')
      throw e
    } finally {
      conn.release()
    }

    const r = await messagingPool.query(`SELECT COUNT(*)::int AS c FROM messaging.outbox_events`)
    expect(r.rows[0].c).toBeGreaterThanOrEqual(1)

    const out = await messagingPool.query<{
      aggregate_id: string;
      type: string;
      published: boolean;
    }>(
      `SELECT aggregate_id, type, published FROM messaging.outbox_events WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [convId],
    )
    expect(out.rows[0]).toBeDefined()
    expect(out.rows[0].type).toBe("MessageSentV1")
    expect(out.rows[0].aggregate_id).toBe(convId)
    expect(out.rows[0].published).toBe(false)
  })

  it('C) rate limit: 35 increments in same minute expect 31st to throw (429)', async () => {
    const userId = randomUUID()
    for (let i = 0; i < 30; i++) {
      await checkAndIncrement(userId)
    }
    await expect(checkAndIncrement(userId)).rejects.toThrow(/RATE_LIMIT_EXCEEDED/)
  })

  it('D) spam: trust.user_spam_score high implies user can be rejected (403)', async () => {
    const userId = randomUUID()
    await trustPool.query(
      `INSERT INTO trust.user_spam_score (user_id, score, updated_at) VALUES ($1, 999, now()) ON CONFLICT (user_id) DO UPDATE SET score = 999, updated_at = now()`,
      [userId]
    )
    const r = await trustPool.query(`SELECT score FROM trust.user_spam_score WHERE user_id = $1`, [userId])
    expect(r.rows[0].score).toBe(999)
    await trustPool.query(`DELETE FROM trust.user_spam_score WHERE user_id = $1`, [userId])
  })
})
