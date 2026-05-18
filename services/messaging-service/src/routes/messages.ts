import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { cached, makeMessagesKey, makeThreadKey } from '../lib/cache.js'
import { pool } from '../lib/db.js'
import { kafka } from '@common/utils/kafka'
import { buildMetadata, sendMessagingEvent } from '../kafkaMessagingEvents.js'
import {
  isBookingOrSystemDirectMessage,
  sqlBookingOrSystemDmRow,
  sqlHumanDirectDmRow,
  sqlHumanPairConversationId,
  stableHumanDmThreadId,
} from '../lib/dm-thread-id.js'
import {
  sendExternalEmail,
  sendExternalSms,
  smtpConfigured,
  smsOutboundAttemptConfigured,
  getExternalContactCapabilities,
  getEmailDeliveryMode,
  getSmsDeliveryMode,
  smsOutboundDeliveryLabel,
} from '../lib/external-delivery.js'

async function checkExternalContactDailyLimit(redis: Redis | null, userId: string): Promise<boolean> {
  if (!redis) return true
  try {
    const day = new Date().toISOString().slice(0, 10)
    const key = `och:extcontact:${userId}:${day}`
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 172800)
    const raw = Number(process.env.MESSAGING_EXTERNAL_CONTACT_DAILY_CAP || '80')
    const cap = Number.isFinite(raw) ? Math.min(500, Math.max(10, Math.floor(raw))) : 80
    return n <= cap
  } catch {
    return true
  }
}

let kafkaProducer: any = null
async function getKafkaProducer() {
  if (!kafkaProducer) {
    kafkaProducer = kafka.producer()
    await Promise.race([
      kafkaProducer.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Kafka connection timeout')), 5000),
      ),
    ])
  }
  return kafkaProducer
}

const THREAD_LISTING_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function fetchListingForMessagingStart(
  listingId: string,
): Promise<{ landlord_id: string; title: string } | null> {
  const base = (process.env.LISTINGS_HTTP || 'http://127.0.0.1:4012').replace(/\/$/, '')
  const url = `${base}/listings/${listingId}`
  let upstream: globalThis.Response
  try {
    const ms = Number(process.env.MESSAGING_LISTING_FETCH_TIMEOUT_MS ?? '12000')
    const timeout = Number.isFinite(ms) ? Math.min(120000, Math.max(1000, ms)) : 12000
    upstream = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  } catch {
    throw new Error('listings_fetch_failed')
  }
  if (upstream.status === 404) return null
  if (!upstream.ok) throw new Error(`listings_${upstream.status}`)
  const j = (await upstream.json()) as Record<string, unknown>
  const landlord_id = String(j.landlord_id ?? j.user_id ?? '').trim()
  const title = String(j.title ?? 'Listing')
  if (!THREAD_LISTING_UUID_RE.test(landlord_id)) return null
  return { landlord_id, title }
}

export default function messagesRouter(redis: Redis | null, cpuCores: number) {
  const router: Router = Router()

  const ROUTE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  /**
   * GET /thread/:id may receive a message row id (deep links), a group id, a persisted
   * thread_id (e.g. booking), or the canonical pair-based inbox id. Normalize so one
   * conversation loads in full and matches GET /threads row ids.
   */
  async function resolveThreadLoadKey(
    threadId: string,
    userId: string,
  ): Promise<{ loadKey: string; responseThreadId: string }> {
    if (!ROUTE_UUID_RE.test(threadId)) {
      return { loadKey: threadId, responseThreadId: threadId }
    }
    try {
      const { rows } = await pool.query(
        `SELECT m.sender_id, m.recipient_id, m.group_id
         FROM messages.messages m
         WHERE m.id::text = $1
           AND (
             m.recipient_id = $2::uuid OR m.sender_id = $2::uuid
             OR EXISTS (
               SELECT 1 FROM messages.group_members gm
               WHERE gm.group_id = m.group_id AND gm.user_id = $2::uuid
             )
           )
         LIMIT 1`,
        [threadId, userId],
      )
      if (rows.length === 0) {
        return { loadKey: threadId, responseThreadId: threadId }
      }
      const m = rows[0] as { sender_id: string; recipient_id: string | null; group_id: string | null }
      if (m.group_id) {
        const gid = String(m.group_id)
        return { loadKey: gid, responseThreadId: gid }
      }
      const r = m.recipient_id != null ? String(m.recipient_id) : ''
      const s = String(m.sender_id)
      if (!r || !ROUTE_UUID_RE.test(r)) {
        return { loadKey: threadId, responseThreadId: threadId }
      }
      const pairKey = stableHumanDmThreadId(s, r)
      return { loadKey: pairKey, responseThreadId: pairKey }
    } catch {
      return { loadKey: threadId, responseThreadId: threadId }
    }
  }

  async function bustThreadCache(threadId: string): Promise<void> {
    if (!redis) return
    try {
      await redis.del(makeThreadKey(threadId, false), makeThreadKey(threadId, true))
    } catch {
      /* ignore cache errors */
    }
  }

  async function threadCacheKeysForMessageId(messageId: string): Promise<string[]> {
    const keys = new Set<string>();
    try {
      const { rows } = await pool.query(
        `SELECT thread_id, group_id, sender_id, recipient_id
         FROM messages.messages WHERE id = $1::uuid LIMIT 1`,
        [messageId],
      );
      const r = rows[0] as
        | { thread_id: string | null; group_id: string | null; sender_id: string; recipient_id: string | null }
        | undefined;
      if (!r) return [];
      if (r.thread_id) keys.add(String(r.thread_id));
      if (r.group_id) keys.add(String(r.group_id));
      const s = String(r.sender_id);
      const rc = r.recipient_id != null ? String(r.recipient_id) : "";
      if (rc && ROUTE_UUID_RE.test(rc) && ROUTE_UUID_RE.test(s)) {
        keys.add(stableHumanDmThreadId(s, rc));
      }
    } catch {
      /* ignore */
    }
    return [...keys];
  }

  /** GET /messages/thread/:id is Redis-cached; bust after any write so sends appear immediately. */
  async function bustThreadCachesAfterWrite(ids: Array<string | null | undefined>): Promise<void> {
    const unique = new Set<string>()
    for (const raw of ids) {
      const t = String(raw || '').trim()
      if (ROUTE_UUID_RE.test(t)) unique.add(t)
    }
    await Promise.all([...unique].map((t) => bustThreadCache(t)))
  }

  // GET /messages - List user's messages (inbox)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const type = req.query.type as string | undefined
    const includeArchived = req.query.includeArchived === 'true'
    const offset = (page - 1) * limit

    const cacheKey = makeMessagesKey(userId!, page, limit, type, includeArchived)
    const result = await cached(
      redis,
      cacheKey,
      30_000, // 30 second cache (messages change frequently)
      async () => {
        try {
          // Optimized: Get user's group IDs first (single query, cached)
          const groupIdsResult = await pool.query(
            'SELECT group_id FROM messages.group_members WHERE user_id = $1',
            [userId]
          )
          const groupIds = groupIdsResult.rows.map((r: { group_id: string }) => r.group_id)

          // Optimized: Use UNION ALL instead of OR for better index usage
          // This allows PostgreSQL to use idx_messages_recipient_created and idx_messages_group_created
          let query: string
          let params: any[]
          
          const hideArchivedSql = includeArchived
            ? ''
            : `AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_archived_threads WHERE user_id = $1))`

          if (groupIds.length > 0) {
            // User has groups - use UNION ALL for both direct and group messages
            query = `
              SELECT 
                m.id,
                m.sender_id,
                m.recipient_id,
                m.group_id,
                m.parent_message_id,
                m.thread_id,
                m.message_type,
                m.subject,
                m.content,
                m.is_read,
                m.created_at,
                m.updated_at,
                g.name as group_name,
                CASE 
                  WHEN m.parent_message_id IS NOT NULL THEN
                    json_build_object(
                      'id', pm.id,
                      'sender_id', pm.sender_id,
                      'subject', pm.subject,
                      'content', LEFT(pm.content, 100) || CASE WHEN LENGTH(pm.content) > 100 THEN '...' ELSE '' END,
                      'message_type', pm.message_type,
                      'created_at', pm.created_at
                    )
                  ELSE NULL
                END as parent_message
              FROM (
                SELECT * FROM messages.messages 
                WHERE recipient_id = $1
                AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
                ${hideArchivedSql}
                ${type ? 'AND message_type = $2' : ''}
                
                UNION ALL
                
                SELECT * FROM messages.messages 
                WHERE group_id = ANY($${type ? '3' : '2'}::uuid[])
                AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
                ${hideArchivedSql}
                ${type ? 'AND message_type = $2' : ''}
              ) m
              LEFT JOIN messages.groups g ON m.group_id = g.id
              LEFT JOIN messages.messages pm ON m.parent_message_id = pm.id
              ORDER BY m.created_at DESC
              LIMIT $${type ? '4' : '3'} OFFSET $${type ? '5' : '4'}
            `
            params = type 
              ? [userId, type, groupIds, limit, offset]
              : [userId, groupIds, limit, offset]
          } else {
            // User has no groups - only direct messages
            query = `
              SELECT 
                m.id,
                m.sender_id,
                m.recipient_id,
                m.group_id,
                m.parent_message_id,
                m.thread_id,
                m.message_type,
                m.subject,
                m.content,
                m.is_read,
                m.created_at,
                m.updated_at,
                g.name as group_name,
                CASE 
                  WHEN m.parent_message_id IS NOT NULL THEN
                    json_build_object(
                      'id', pm.id,
                      'sender_id', pm.sender_id,
                      'subject', pm.subject,
                      'content', LEFT(pm.content, 100) || CASE WHEN LENGTH(pm.content) > 100 THEN '...' ELSE '' END,
                      'message_type', pm.message_type,
                      'created_at', pm.created_at
                    )
                  ELSE NULL
                END as parent_message
              FROM messages.messages m
              LEFT JOIN messages.groups g ON m.group_id = g.id
              LEFT JOIN messages.messages pm ON m.parent_message_id = pm.id
              WHERE m.recipient_id = $1
              AND (m.thread_id IS NULL OR m.thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
              ${
                includeArchived
                  ? ''
                  : `AND (m.thread_id IS NULL OR m.thread_id NOT IN (SELECT thread_id FROM messages.user_archived_threads WHERE user_id = $1))`
              }
              ${type ? 'AND m.message_type = $2' : ''}
              ORDER BY m.created_at DESC
              LIMIT $${type ? '3' : '2'} OFFSET $${type ? '4' : '3'}
            `
            params = type ? [userId, type, limit, offset] : [userId, limit, offset]
          }
          
          const { rows } = await pool.query(query, params)

          // Optimized count query using UNION ALL
          let countQuery: string
          let countParams: any[]
          
          if (groupIds.length > 0) {
            countQuery = `
              SELECT COUNT(*) as total
              FROM (
                SELECT id FROM messages.messages 
                WHERE recipient_id = $1
                AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
                ${hideArchivedSql}
                ${type ? 'AND message_type = $2' : ''}
                
                UNION ALL
                
                SELECT id FROM messages.messages 
                WHERE group_id = ANY($${type ? '3' : '2'}::uuid[])
                AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
                ${hideArchivedSql}
                ${type ? 'AND message_type = $2' : ''}
              ) m
            `
            countParams = type ? [userId, type, groupIds] : [userId, groupIds]
          } else {
            countQuery = `
              SELECT COUNT(*) as total
              FROM messages.messages m
              WHERE m.recipient_id = $1
              AND (m.thread_id IS NULL OR m.thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
              ${
                includeArchived
                  ? ''
                  : `AND (m.thread_id IS NULL OR m.thread_id NOT IN (SELECT thread_id FROM messages.user_archived_threads WHERE user_id = $1))`
              }
              ${type ? 'AND m.message_type = $2' : ''}
            `
            countParams = type ? [userId, type] : [userId]
          }
          
          const { rows: countRows } = await pool.query(countQuery, countParams)
          const total = parseInt(countRows[0].total, 10)

          return {
            messages: rows,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          }
        } catch (err) {
          console.error('[messaging] Error fetching messages:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /messages/start — begin landlord DM from a listing (renter → lister's user_id)
  router.post('/start', async (req: AuthedRequest, res: Response) => {
    const { listing_id, renter_id, initial_message } = req.body as {
      listing_id?: string
      renter_id?: string
      initial_message?: string
    }
    if (!listing_id || !renter_id || !(initial_message && String(initial_message).trim())) {
      return res.status(400).json({
        error: 'listing_id, renter_id, initial_message required',
      })
    }
    if (!THREAD_LISTING_UUID_RE.test(listing_id)) {
      return res.status(400).json({ error: 'invalid listing_id' })
    }
    if (renter_id !== req.userId) {
      return res.status(403).json({ error: 'renter_id must match authenticated user' })
    }
    let lj: { landlord_id: string; title: string } | null
    try {
      lj = await fetchListingForMessagingStart(listing_id)
    } catch {
      return res.status(502).json({ error: 'listing fetch failed' })
    }
    if (!lj) {
      return res.status(404).json({ error: 'listing not found' })
    }

    const subject = `[listing:${listing_id}] ${lj.title}`.slice(0, 500)
    const dmThreadId = stableHumanDmThreadId(String(renter_id), String(lj.landlord_id))

    try {
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id, thread_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, NULL, NULL, $3::uuid, $4, $5, $6, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        renter_id,
        lj.landlord_id,
        dmThreadId,
        'ListingInquiry',
        subject,
        String(initial_message).slice(0, 8000),
      ])
      const message = rows[0]

      const producer = await getKafkaProducer()
      const kafkaKey = lj.landlord_id
      const createdAt =
        message.created_at instanceof Date
          ? message.created_at.toISOString()
          : String(message.created_at)
      await sendMessagingEvent(producer, kafkaKey, {
        metadata: buildMetadata({
          event_type: 'MessageSent',
          aggregate_id: message.id,
          aggregate_type: 'message',
        }),
        message_id: message.id,
        sender_id: renter_id,
        recipient_id: lj.landlord_id,
        thread_id: message.thread_id || '',
        message_type: 'ListingInquiry',
        subject,
        content: String(initial_message),
        listing_id,
        created_at: createdAt,
      })

      await bustThreadCachesAfterWrite([message.thread_id, dmThreadId])

      return res.status(201).json({
        listing_id,
        landlord_id: lj.landlord_id,
        thread_id: message.thread_id || dmThreadId,
        message,
      })
    } catch (err: unknown) {
      console.error('[messaging] Error starting listing thread:', err)
      return res.status(500).json({ error: 'Failed to start conversation' })
    }
  })

  // POST /messages - Send new message (direct or group)
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const {
      recipient_id,
      group_id,
      message_type,
      subject,
      content,
      parent_message_id,
      reply_to_message_id,
      thread_id,
    } = req.body as {
      recipient_id?: string;
      group_id?: string;
      message_type?: string;
      subject?: string;
      content?: string;
      parent_message_id?: string;
      reply_to_message_id?: string;
      thread_id?: string;
    }
    const parentResolved =
      (typeof reply_to_message_id === "string" && reply_to_message_id.trim()) ||
      (typeof parent_message_id === "string" && parent_message_id.trim()) ||
      null
    const sender_id = req.userId

    // Validate: must have either recipient_id (direct) or group_id (group), but not both
    if ((!recipient_id && !group_id) || (recipient_id && group_id)) {
      return res.status(400).json({
        error: 'Either recipient_id (direct message) or group_id (group message) required, but not both',
      })
    }

    if (!message_type || !content) {
      return res.status(400).json({
        error: 'message_type and content required',
      })
    }
    const rawSubj = String(subject ?? "").trim();
    const bookingish = Boolean(
      recipient_id &&
        !group_id &&
        isBookingOrSystemDirectMessage(String(message_type), String(content)),
    );
    /** In-app human DMs never persist a subject; groups and booking/system lines may. */
    const subjectFinal = group_id ? rawSubj || "Group chat" : bookingish ? rawSubj : "";

    // If group message, verify user is a member
    if (group_id) {
      const memberCheck = await pool.query(
        'SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [group_id, sender_id]
      )
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }
    }

    let effectiveThreadId: string | null = null
    if (group_id) {
      effectiveThreadId = thread_id && ROUTE_UUID_RE.test(String(thread_id)) ? String(thread_id).trim() : null
    } else if (recipient_id) {
      if (bookingish) {
        const tid = String(thread_id ?? "").trim()
        effectiveThreadId = ROUTE_UUID_RE.test(tid) ? tid : null
      } else {
        effectiveThreadId = stableHumanDmThreadId(String(sender_id), String(recipient_id))
      }
    }

    try {
      // Insert message into database
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id, thread_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id || null,
        group_id || null,
        parentResolved && ROUTE_UUID_RE.test(String(parentResolved)) ? String(parentResolved).trim() : null,
        effectiveThreadId,
        message_type,
        subjectFinal,
        content,
      ])
      const message = rows[0] as Record<string, unknown>

      const producer = await getKafkaProducer()
      const kafkaKey = String(group_id || recipient_id || message.id || "")
      const createdAt =
        message.created_at instanceof Date ? message.created_at.toISOString() : String(message.created_at)
      await sendMessagingEvent(producer, kafkaKey, {
        metadata: buildMetadata({
          event_type: 'MessageSent',
          aggregate_id: String(message.id ?? ""),
          aggregate_type: 'message',
        }),
        message_id: String(message.id ?? ""),
        sender_id,
        recipient_id: recipient_id || '',
        thread_id: String(message.thread_id ?? ""),
        message_type,
        subject: subjectFinal,
        content,
        created_at: createdAt,
      })

      await bustThreadCachesAfterWrite([
        message.thread_id != null && String(message.thread_id).trim() ? String(message.thread_id) : null,
        effectiveThreadId,
        group_id || null,
        thread_id || null,
      ])

      res.status(201).json({
        ...message,
        reply_to_message_id: message.parent_message_id ?? null,
        reactions: [],
      })
    } catch (err: any) {
      console.error('[messaging] Error creating message:', err)
      res.status(500).json({ error: 'Failed to create message' })
    }
  })

  /**
   * GET /messages/users/search?q=
   * Recipient picker for compose. Uses messaging DB `auth.users` mirror (same rows as thread list upserts).
   * Registered before `GET /:messageId` so `/users/search` is not captured as a message id.
   */
  router.get('/users/search', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId!
    const raw = String(req.query.q ?? '').trim().replace(/^@+/, '')
    if (raw.length < 2) {
      return res.status(400).json({ error: 'q must be at least 2 characters' })
    }
    const safe = raw.replace(/%/g, '').replace(/_/g, '').slice(0, 80)
    const pattern = `%${safe}%`
    try {
      const { rows } = await pool.query(
        `/* messaging-users-search v1 */
         SELECT u.id::text AS id,
                COALESCE(
                  NULLIF(TRIM(u.username::text), ''),
                  NULLIF(TRIM(u.display_username::text), ''),
                  NULLIF(SPLIT_PART(COALESCE(u.email::text, ''), '@', 1), '')
                ) AS username,
                COALESCE(
                  NULLIF(TRIM(u.display_username::text), ''),
                  NULLIF(TRIM(u.display_name::text), ''),
                  NULLIF(TRIM(u.username::text), '')
                ) AS display_name
         FROM auth.users u
         WHERE u.id <> $1::uuid
           AND COALESCE(u.is_deleted, false) = false
           AND (
             COALESCE(u.username::text, '') ILIKE $2
             OR COALESCE(u.display_username::text, '') ILIKE $2
             OR COALESCE(u.display_name::text, '') ILIKE $2
             OR COALESCE(u.email::text, '') ILIKE $2
           )
         ORDER BY (LOWER(COALESCE(u.username::text, '')) = LOWER($3)) DESC,
                  (LOWER(COALESCE(u.display_username::text, '')) = LOWER($3)) DESC,
                  u.display_username NULLS LAST
         LIMIT 25`,
        [userId, pattern, raw],
      )
      return res.json({ users: rows })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === '42P01' || code === '42703') {
        return res.json({ users: [] })
      }
      console.error('[messaging] users/search', e)
      return res.status(500).json({ error: 'Failed to search users' })
    }
  })

  router.post('/external-contact', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId!
    const {
      contact_method,
      recipient_email,
      recipient_phone,
      subject,
      body,
      listing_id,
    } = req.body as Record<string, unknown>
    const method = String(contact_method || '').trim().toLowerCase()
    const msgBody = String(body || '').trim()
    if (!['email', 'sms'].includes(method)) {
      return res.status(400).json({ error: 'contact_method must be email or sms' })
    }
    if (!msgBody) return res.status(400).json({ error: 'body required' })
    const toEmail = String(recipient_email || '').trim()
    const toPhone = String(recipient_phone || '').trim()
    if (method === 'email' && !toEmail) return res.status(400).json({ error: 'recipient_email required' })
    if (method === 'sms' && !toPhone) return res.status(400).json({ error: 'recipient_phone required' })

    const underCap = await checkExternalContactDailyLimit(redis, userId)
    if (!underCap) {
      return res.status(429).json({
        error: 'rate_limit',
        message: 'Too many external sends today. Try again tomorrow.',
      })
    }

    const listingRaw = String(listing_id || '').trim()
    const listingUuid = ROUTE_UUID_RE.test(listingRaw) ? listingRaw : ""

    type ExtStatus = 'sent' | 'failed' | 'dev_mock'

    async function insertExternalHistory(params: {
      contactMethod: string
      email: string
      phone: string
      subj: string | null
      bodyText: string
      providerId: string | null
      status: ExtStatus
      deliveryError: string | null
      fullColumns: boolean
    }): Promise<Record<string, unknown>> {
      const { contactMethod, email, phone, subj, bodyText, providerId, status, deliveryError, fullColumns } = params
      const sentAt = status === 'sent' ? new Date() : null
      if (fullColumns) {
        const { rows } = await pool.query(
          `INSERT INTO messages.external_contacts
             (user_id, contact_method, recipient_email, recipient_phone, subject, body, listing_id, status, sent_at, delivery_error, provider_message_id)
           VALUES ($1::uuid, $2, NULLIF($3, '')::text, NULLIF($4, '')::text, $5, $6, NULLIF($7, '')::uuid, $8, $9, $10, $11)
           RETURNING id::text, status, created_at, sent_at, provider_message_id, delivery_error`,
          [
            userId,
            contactMethod,
            email,
            phone,
            subj,
            bodyText.slice(0, 8000),
            listingUuid,
            status,
            sentAt,
            deliveryError,
            providerId,
          ],
        )
        return rows[0] as Record<string, unknown>
      }
      const { rows } = await pool.query(
        `INSERT INTO messages.external_contacts
           (user_id, contact_method, recipient_email, recipient_phone, subject, body, listing_id, status)
         VALUES ($1::uuid, $2, NULLIF($3, '')::text, NULLIF($4, '')::text, $5, $6, NULLIF($7, '')::uuid, $8)
         RETURNING id::text, status, created_at`,
        [userId, contactMethod, email, phone, subj, bodyText.slice(0, 8000), listingUuid, status],
      )
      return rows[0] as Record<string, unknown>
    }

    if (method === 'email') {
      if (!smtpConfigured()) {
        return res.status(503).json({
          error: 'email_not_configured',
          message:
            'Outgoing email transport is not configured (set SMTP_HOST and usually SMTP_FROM or SMTP_USER). This is not an in-app DM.',
        })
      }
      const sent = await sendExternalEmail({
        to: toEmail,
        subject: String(subject || '').trim() || 'Message from Off-Campus Housing',
        text: msgBody,
        replyTo: process.env.SMTP_REPLY_TO?.trim() || undefined,
      })
      if (!sent.ok) {
        try {
          const row = await insertExternalHistory({
            contactMethod: method,
            email: toEmail,
            phone: toPhone,
            subj: String(subject || '').trim() || null,
            bodyText: msgBody,
            providerId: null,
            status: 'failed',
            deliveryError: sent.error,
            fullColumns: true,
          })
          return res.status(502).json({
            error: 'send_failed',
            message: sent.error,
            send_ok: false,
            history: row,
            email_delivery_mode: getEmailDeliveryMode(),
            transport_attempted: true,
          })
        } catch (histErr: any) {
          if ((histErr as { code?: string })?.code === '42703') {
            try {
              const row = await insertExternalHistory({
                contactMethod: method,
                email: toEmail,
                phone: toPhone,
                subj: String(subject || '').trim() || null,
                bodyText: msgBody,
                providerId: null,
                status: 'failed',
                deliveryError: sent.error,
                fullColumns: false,
              })
              return res.status(502).json({
                error: 'send_failed',
                message: sent.error,
                send_ok: false,
                history: row,
                email_delivery_mode: getEmailDeliveryMode(),
              })
            } catch {
              /* fall through */
            }
          }
          console.error('[messaging] external email failed send + history insert failed:', histErr)
        }
        return res.status(502).json({
          error: 'send_failed',
          message: sent.error,
          send_ok: false,
          email_delivery_mode: getEmailDeliveryMode(),
        })
      }
      const providerId = sent.messageId?.trim() || null
      try {
        const row = await insertExternalHistory({
          contactMethod: method,
          email: toEmail,
          phone: toPhone,
          subj: String(subject || '').trim() || null,
          bodyText: msgBody,
          providerId,
          status: 'sent',
          deliveryError: null,
          fullColumns: true,
        })
        return res.status(201).json({
          ...row,
          send_ok: true,
          message: 'Email accepted by SMTP transport.',
          email_delivery: 'smtp',
          email_delivery_mode: sent.email_delivery_mode,
        })
      } catch (err: any) {
        if ((err as { code?: string })?.code === '42P01') {
          return res.status(501).json({ error: 'external_contacts table missing; run db migration 15' })
        }
        if ((err as { code?: string })?.code === '42703') {
          console.warn('[messaging] external_contacts missing delivery columns; apply infra/db/20-messaging-external-contact-delivery.sql')
          const row = await insertExternalHistory({
            contactMethod: method,
            email: toEmail,
            phone: toPhone,
            subj: String(subject || '').trim() || null,
            bodyText: msgBody,
            providerId,
            status: 'sent',
            deliveryError: null,
            fullColumns: false,
          })
          return res.status(201).json({
            ...row,
            send_ok: true,
            message: 'Email accepted by SMTP. Apply DB migration 20 for full delivery metadata columns.',
            email_delivery: 'smtp',
            email_delivery_mode: sent.email_delivery_mode,
          })
        }
        console.error('[messaging] external contact insert failed:', err)
        return res.status(500).json({ error: 'history_persist_failed', message: String(err?.message || err) })
      }
    }

    if (!smsOutboundAttemptConfigured()) {
      return res.status(503).json({
        error: 'sms_not_configured',
        message:
          'SMS transport is not configured. Set SMS_DELIVERY_MODE=provider with Twilio, or self_hosted_gateway with SMS_SELF_HOSTED_URL, or mock for development.',
      })
    }
    const smsSent = await sendExternalSms(toPhone, msgBody.slice(0, 1600))
    if (!smsSent.ok) {
      try {
        const row = await insertExternalHistory({
          contactMethod: method,
          email: '',
          phone: toPhone,
          subj: null,
          bodyText: msgBody,
          providerId: null,
          status: 'failed',
          deliveryError: smsSent.error,
          fullColumns: true,
        })
        return res.status(502).json({
          error: 'send_failed',
          message: smsSent.error,
          send_ok: false,
          history: row,
          sms_delivery_mode: smsSent.sms_delivery_mode ?? getSmsDeliveryMode(),
        })
      } catch (histErr: any) {
        if ((histErr as { code?: string })?.code === '42703') {
          try {
            const row = await insertExternalHistory({
              contactMethod: method,
              email: '',
              phone: toPhone,
              subj: null,
              bodyText: msgBody,
              providerId: null,
              status: 'failed',
              deliveryError: smsSent.error,
              fullColumns: false,
            })
            return res.status(502).json({
              error: 'send_failed',
              message: smsSent.error,
              send_ok: false,
              history: row,
              sms_delivery_mode: smsSent.sms_delivery_mode ?? getSmsDeliveryMode(),
            })
          } catch {
            /* fall through */
          }
        }
        console.error('[messaging] external sms failed send + history insert failed:', histErr)
      }
      return res.status(502).json({
        error: 'send_failed',
        message: smsSent.error,
        send_ok: false,
        sms_delivery_mode: smsSent.sms_delivery_mode ?? getSmsDeliveryMode(),
      })
    }
    const providerId = smsSent.messageId?.trim() || null
    const smsStatus: ExtStatus = smsSent.dev_mock ? 'dev_mock' : 'sent'
    const smsMessage = smsSent.dev_mock
      ? 'Dev mock only: nothing was sent to a carrier or handset. Logged for testing.'
      : 'SMS accepted by configured transport.'
    try {
      const row = await insertExternalHistory({
        contactMethod: method,
        email: '',
        phone: toPhone,
        subj: null,
        bodyText: msgBody,
        providerId,
        status: smsStatus,
        deliveryError: null,
        fullColumns: true,
      })
      return res.status(201).json({
        ...row,
        send_ok: !smsSent.dev_mock,
        message: smsMessage,
        sms_delivery: smsOutboundDeliveryLabel(),
        sms_delivery_mode: smsSent.sms_delivery_mode,
      })
    } catch (err: any) {
      if ((err as { code?: string })?.code === '42P01') {
        return res.status(501).json({ error: 'external_contacts table missing; run db migration 15' })
      }
      if ((err as { code?: string })?.code === '42703') {
        console.warn('[messaging] external_contacts missing delivery columns; apply migration 20')
        const row = await insertExternalHistory({
          contactMethod: method,
          email: '',
          phone: toPhone,
          subj: null,
          bodyText: msgBody,
          providerId,
          status: smsStatus,
          deliveryError: null,
          fullColumns: false,
        })
        return res.status(201).json({
          ...row,
          send_ok: !smsSent.dev_mock,
          message: `${smsMessage} Apply DB migration 20 for full delivery metadata.`,
          sms_delivery: smsOutboundDeliveryLabel(),
          sms_delivery_mode: smsSent.sms_delivery_mode,
        })
      }
      console.error('[messaging] external sms history insert failed:', err)
      return res.status(500).json({ error: 'history_persist_failed', message: String(err?.message || err) })
    }
  })

  router.get('/external-contact/capabilities', (_req: AuthedRequest, res: Response) => {
    return res.json(getExternalContactCapabilities())
  })

  router.get('/external-contact', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId!
    const limitRaw = Number(req.query.limit || 30)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 30
    try {
      const { rows } = await pool.query(
        `SELECT id::text, contact_method, recipient_email, recipient_phone, subject, body, status, created_at,
                sent_at, delivery_error, provider_message_id
         FROM messages.external_contacts
         WHERE user_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit],
      )
      return res.json({ items: rows })
    } catch (err: any) {
      if ((err as { code?: string })?.code === '42P01') {
        return res.json({ items: [] })
      }
      if ((err as { code?: string })?.code === '42703') {
        try {
          const { rows } = await pool.query(
            `SELECT id::text, contact_method, recipient_email, recipient_phone, subject, body, status, created_at
             FROM messages.external_contacts
             WHERE user_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit],
          )
          return res.json({ items: rows })
        } catch (e2: any) {
          console.error('[messaging] external contact list fallback failed:', e2)
          return res.status(500).json({ error: 'Failed to list external contact history' })
        }
      }
      console.error('[messaging] external contact list failed:', err)
      return res.status(500).json({ error: 'Failed to list external contact history' })
    }
  })

  // GET /messages/archived - List archived threads (chat archive)
  router.get('/archived', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId
    try {
      const { rows } = await pool.query(
        `SELECT t.thread_id, t.archived_at,
          (SELECT m.subject FROM messages.messages m WHERE m.thread_id = t.thread_id
           AND (m.recipient_id = $1 OR m.sender_id = $1 OR m.group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $1))
           ORDER BY m.created_at ASC LIMIT 1) AS subject,
          (SELECT m.created_at FROM messages.messages m WHERE m.thread_id = t.thread_id
           AND (m.recipient_id = $1 OR m.sender_id = $1 OR m.group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $1))
           ORDER BY m.created_at ASC LIMIT 1) AS created_at
         FROM messages.user_archived_threads t
         WHERE t.user_id = $1
         ORDER BY t.archived_at DESC`,
        [userId]
      )
      res.json({ archived: rows })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      if (code === '42P01') {
        return res.json({ archived: [] })
      }
      console.error('[messaging] Error listing archived:', { code, message: err?.message, status: 500 })
      res.status(500).json({ error: 'Failed to list archived' })
    }
  })

  // POST /messages/thread/:threadId/archive - Archive chat (hide from inbox; GET thread needs includeArchived=true)
  router.post('/thread/:threadId/archive', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const access = await client.query(
        `SELECT 1 WHERE
          EXISTS (
            SELECT 1 FROM messages.group_members gm
            WHERE gm.group_id::text = $1 AND gm.user_id = $2::uuid
          )
          OR EXISTS (
            SELECT 1 FROM messages.messages m
            WHERE (m.thread_id::text = $1 OR m.group_id::text = $1)
              AND (
                m.sender_id = $2::uuid
                OR m.recipient_id = $2::uuid
                OR m.group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $2::uuid)
              )
            LIMIT 1
          )`,
        [threadId, userId],
      )
      if (access.rows.length === 0) {
        const exists = await client.query(
          `SELECT 1 FROM messages.messages WHERE thread_id::text = $1 OR group_id::text = $1 LIMIT 1`,
          [threadId],
        )
        await client.query('ROLLBACK')
        if (exists.rows.length === 0) {
          return res.status(404).json({ error: 'Thread not found' })
        }
        return res.status(403).json({ error: 'You are not a participant in this thread' })
      }
      await client.query(
        `INSERT INTO messages.user_archived_threads (user_id, thread_id)
         VALUES ($1, $2) ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [userId, threadId],
      )
      await client.query('COMMIT')
      await bustThreadCache(threadId)
      return res.status(204).end()
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* ignore */
      }
      const code = (err as { code?: string })?.code
      if (code === '42P01') {
        console.error('[messaging] Archive thread: missing table user_archived_threads (501)', { code })
        return res.status(501).json({
          error:
            'user_archived_threads table not found; run migration 04-social-schema-archive-recall-kickban.sql',
        })
      }
      if (code === '23505') {
        await bustThreadCache(threadId)
        return res.status(204).end()
      }
      console.error('[messaging] Error archiving thread:', {
        code,
        message: (err as { message?: string })?.message,
        status: 500,
      })
      return res.status(500).json({ error: 'Failed to archive thread' })
    } finally {
      client.release()
    }
  })

  // DELETE /messages/thread/:threadId/archive - Unarchive (idempotent)
  router.delete('/thread/:threadId/archive', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    try {
      await pool.query(
        `DELETE FROM messages.user_archived_threads WHERE user_id = $1 AND thread_id = $2`,
        [userId, threadId],
      )
      await bustThreadCache(threadId)
      return res.status(204).end()
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === '42P01') {
        return res.status(501).json({
          error:
            'user_archived_threads table not found; run migration 04-social-schema-archive-recall-kickban.sql',
        })
      }
      console.error('[messaging] Error unarchiving thread:', err)
      return res.status(500).json({ error: 'Failed to unarchive thread' })
    }
  })

  // POST /messages/thread/:threadId/delete - Delete chat for me (hide thread from list; messages stay for others)
  router.post('/thread/:threadId/delete', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    try {
      const access = await pool.query(
        `SELECT 1 WHERE
          EXISTS (
            SELECT 1 FROM messages.group_members gm
            WHERE gm.group_id::text = $1 AND gm.user_id = $2::uuid
          )
          OR EXISTS (
            SELECT 1 FROM messages.messages m
            WHERE (m.thread_id::text = $1 OR m.group_id::text = $1)
              AND (
                m.sender_id = $2::uuid
                OR m.recipient_id = $2::uuid
                OR m.group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $2::uuid)
              )
            LIMIT 1
          )`,
        [threadId, userId]
      )
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Thread not found' })
      }
      await pool.query(
        `INSERT INTO messages.user_deleted_threads (user_id, thread_id)
         VALUES ($1, $2) ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [userId, threadId]
      )
      res.status(201).json({ thread_id: threadId, deleted_for_me: true })
    } catch (err: any) {
      if ((err as { code?: string })?.code === '42P01') {
        return res.status(501).json({ error: 'user_deleted_threads table not found; run migration 04-social-schema-archive-recall-kickban.sql' })
      }
      console.error('[messaging] Error deleting thread for user:', err)
      res.status(500).json({ error: 'Failed to delete thread' })
    }
  })

  // ============================================================
  // GROUP CHAT ENDPOINTS (MUST be before /:messageId routes — else GET /groups matches /:messageId)
  // ============================================================

  // POST /messages/groups - Create a new group
  router.post('/groups', async (req: AuthedRequest, res: Response) => {
    console.log('[messaging] POST /messages/groups called', { name: req.body?.name, userId: req.userId })
    const { name, description } = req.body
    const created_by = req.userId

    if (!name) {
      console.warn('[messaging] Group creation failed: name required')
      return res.status(400).json({ error: 'name required' })
    }

    // Check if request was aborted
    if (req.aborted) {
      console.warn('[messaging] Request aborted before processing group creation')
      return res.status(499).end() // 499 Client Closed Request
    }

    try {
      console.log('[messaging] Starting group creation query...')
      // Use pool.query directly instead of pool.connect() to avoid connection pool exhaustion
      // Add timeout to prevent hanging on slow database operations
      const groupResult = await Promise.race([
        pool.query(`
          INSERT INTO messages.groups (name, description, created_by)
          VALUES ($1, $2, $3)
          RETURNING id, name, description, created_by, created_at, updated_at
        `, [name, description || null, created_by]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        )
      ]) as any

      const group = groupResult.rows[0]
      console.log('[messaging] Group created:', group.id)

      // Check if request was aborted after first query
      if (req.aborted) {
        console.warn('[messaging] Request aborted after group creation, before adding admin')
        return res.status(499).end()
      }

      // Add creator as owner (highest role; admin = promoted, owner = creator)
      console.log('[messaging] Adding creator as owner...')
      await Promise.race([
        pool.query(
          'INSERT INTO messages.group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
          [group.id, created_by, 'owner']
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database query timeout')), 5000)
        )
      ])

      // Check if request was aborted before sending response
      if (req.aborted) {
        console.warn('[messaging] Request aborted before sending response')
        return res.status(499).end()
      }

      console.log('[messaging] Group creation successful, sending response')
      res.status(201).json(group)
    } catch (err: any) {
      // Don't send response if request was aborted
      if (req.aborted) {
        console.warn('[messaging] Request aborted during error handling')
        return
      }
      console.error('[messaging] Error creating group:', err?.message || err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create group', details: err?.message || 'Unknown error' })
      }
    }
  })

  // POST /messages/groups/:groupId/members - Add member to group
  router.post('/groups/:groupId/members', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const { user_id } = req.body
    const requester_id = req.userId

    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' })
    }

    try {
      // Check if user is banned from this group
      const banCheck = await pool.query(
        `SELECT 1 FROM messages.group_bans WHERE group_id = $1 AND user_id = $2
         AND (expires_at IS NULL OR expires_at > now())`,
        [groupId, user_id]
      )
      if (banCheck.rows.length > 0) {
        return res.status(403).json({ error: 'User is banned from this group' })
      }
      // Verify requester is admin or moderator
      const roleCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, requester_id]
      )
      if (roleCheck.rows.length === 0 || !['owner', 'admin', 'moderator'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only admins and moderators can add members' })
      }

      // Add member
      await pool.query(
        'INSERT INTO messages.group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [groupId, user_id, 'member']
      )

      res.status(201).json({ group_id: groupId, user_id, role: 'member' })
    } catch (err: any) {
      console.error('[messaging] Error adding group member:', err)
      res.status(500).json({ error: 'Failed to add group member' })
    }
  })

  // POST /messages/groups/:groupId/kick - Kick user from group (admin/owner/moderator only)
  router.post('/groups/:groupId/kick', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const { user_id: targetUserId } = req.body
    const requester_id = req.userId

    if (!targetUserId) {
      return res.status(400).json({ error: 'user_id required' })
    }

    try {
      const roleCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, requester_id]
      )
      if (roleCheck.rows.length === 0 || !['owner', 'admin', 'moderator'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only owners, admins, or moderators can kick members' })
      }
      // Cannot kick owner (unless you are owner)
      const targetRole = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      )
      if (targetRole.rows.length === 0) {
        return res.status(404).json({ error: 'User is not a member of this group' })
      }
      if (targetRole.rows[0].role === 'owner' && roleCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can kick the owner' })
      }

      await pool.query(
        'DELETE FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      )
      res.json({ group_id: groupId, kicked_user_id: targetUserId })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      console.error('[messaging] Error kicking member:', { code, message: err?.message, status: 500 })
      res.status(500).json({ error: 'Failed to kick member' })
    }
  })

  // POST /messages/groups/:groupId/ban - Ban user from group (admin/owner only)
  router.post('/groups/:groupId/ban', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const { user_id: targetUserId, reason, expires_at } = req.body
    const requester_id = req.userId

    if (!targetUserId) {
      return res.status(400).json({ error: 'user_id required' })
    }

    try {
      const roleCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, requester_id]
      )
      if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only owners or admins can ban members' })
      }

      await pool.query(
        `INSERT INTO messages.group_bans (group_id, user_id, banned_by, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (group_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, expires_at = $5`,
        [groupId, targetUserId, requester_id, reason || null, expires_at || null]
      )
      await pool.query(
        'DELETE FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      )
      res.status(201).json({ group_id: groupId, banned_user_id: targetUserId, reason: reason || null })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      if (code === '42P01') {
        console.error('[messaging] Ban member: missing table group_bans (501)', { code })
        return res.status(501).json({ error: 'group_bans table not found; run migration 04-social-schema-archive-recall-kickban.sql' })
      }
      console.error('[messaging] Error banning member:', { code, message: err?.message, status: 500 })
      res.status(500).json({ error: 'Failed to ban member' })
    }
  })

  // DELETE /messages/groups/:groupId/ban/:userId - Unban user
  router.delete('/groups/:groupId/ban/:userId', async (req: AuthedRequest, res: Response) => {
    const { groupId, userId: targetUserId } = req.params
    const requester_id = req.userId

    try {
      const roleCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, requester_id]
      )
      if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only owners or admins can unban' })
      }

      const result = await pool.query(
        'DELETE FROM messages.group_bans WHERE group_id = $1 AND user_id = $2 RETURNING 1',
        [groupId, targetUserId]
      )
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'User is not banned from this group' })
      }
      res.status(204).end()
    } catch (err: any) {
      console.error('[messaging] Error unbanning:', err)
      res.status(500).json({ error: 'Failed to unban' })
    }
  })

  // GET /messages/groups - List user's groups (MUST be before /groups/:groupId so exact path matches first)
  router.get('/groups', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId

    try {
      const query = `
        SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.updated_at,
               gm.role, gm.joined_at
        FROM messages.groups g
        INNER JOIN messages.group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = $1
        ORDER BY COALESCE(g.updated_at, g.created_at) DESC
      `
      const { rows } = await pool.query(query, [userId])

      res.json({ groups: rows })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      const msg = (err as Error)?.message
      console.error('[messaging] Error fetching groups:', { code, message: msg, status: 500 })
      res.status(500).json({ error: 'Failed to fetch groups' })
    }
  })

  // GET /messages/groups/:groupId - Get group details
  router.get('/groups/:groupId', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const userId = req.userId

    try {
      // Verify user is a member
      const memberCheck = await pool.query(
        'SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      )
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }

      // Get group with members
      const groupQuery = await pool.query(
        'SELECT id, name, description, created_by, created_at, updated_at FROM messages.groups WHERE id = $1',
        [groupId]
      )
      const membersQuery = await pool.query(
        'SELECT user_id, role, joined_at FROM messages.group_members WHERE group_id = $1 ORDER BY joined_at ASC',
        [groupId]
      )

      res.json({
        ...groupQuery.rows[0],
        members: membersQuery.rows,
      })
    } catch (err) {
      console.error('[messaging] Error fetching group:', err)
      res.status(500).json({ error: 'Failed to fetch group' })
    }
  })

  // DELETE /messages/groups/:groupId/leave - User leaves a group (MUST be before /groups/:groupId)
  router.delete('/groups/:groupId/leave', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const userId = req.userId

    try {
      // Optimized: Single query to get user role and elevated-role count (owner/admin)
      const result = await pool.query(
        `WITH user_member AS (
          SELECT role FROM messages.group_members
          WHERE group_id = $1 AND user_id = $2
        ),
        elevated_count AS (
          SELECT COUNT(*)::int as count FROM messages.group_members
          WHERE group_id = $1 AND role IN ('owner', 'admin')
        )
        SELECT
          (SELECT role FROM user_member) as user_role,
          (SELECT count FROM elevated_count) as elevated_count
        `,
        [groupId, userId]
      )

      if (!result.rows[0]?.user_role) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }

      const userRole = result.rows[0].user_role
      const elevatedCount = result.rows[0].elevated_count || 0

      // Prevent leaving if user is the only owner/admin (must transfer role or delete group)
      if (['owner', 'admin'].includes(userRole) && elevatedCount === 1) {
        return res.status(400).json({
          error: 'Cannot leave group: you are the only owner/admin. Transfer role or delete the group instead.'
        })
      }

      // Remove user from group (optimized with index)
      await pool.query(
        'DELETE FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      )

      res.status(204).end()
    } catch (err: any) {
      console.error('[messaging] Error leaving group:', err)
      res.status(500).json({ error: 'Failed to leave group' })
    }
  })

  // DELETE /messages/groups/:groupId - Delete/Archive a group (admin only)
  router.delete('/groups/:groupId', async (req: AuthedRequest, res: Response) => {
    const { groupId } = req.params
    const userId = req.userId
    const archive = req.query.archive === 'true' // Optional: archive instead of delete

    try {
      // Verify user is owner or admin
      const memberCheck = await pool.query(
        'SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      )
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this group' })
      }
      if (!['owner', 'admin'].includes(memberCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Only owners or admins can delete/archive groups' })
      }

      if (archive) {
        // Archive: Mark group as archived (soft delete)
        // Use transaction for consistency
        const client = await pool.connect()
        try {
          await client.query('BEGIN')

          // Mark group as archived
          await client.query(
            'UPDATE messages.groups SET archived = true, updated_at = now() WHERE id = $1',
            [groupId]
          )

          // Optionally archive all group messages (if schema supports it)
          // This is a soft delete - messages remain but marked as archived
          await client.query(
            'UPDATE messages.messages SET archived = true WHERE group_id = $1',
            [groupId]
          ).catch(() => {
            // Ignore if archived column doesn't exist on messages table
          })

          await client.query('COMMIT')

          res.json({
            id: groupId,
            archived: true,
            message: 'Group archived successfully'
          })
        } catch (err: any) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }
      } else {
        // Delete: Remove all group members and messages, then delete the group
        // Use transaction for atomicity
        const client = await pool.connect()
        try {
          await client.query('BEGIN')

          // Delete all group members (cascade will handle related data if configured)
          await client.query(
            'DELETE FROM messages.group_members WHERE group_id = $1',
            [groupId]
          )

          // Delete all group messages
          await client.query(
            'DELETE FROM messages.messages WHERE group_id = $1',
            [groupId]
          )

          // Finally delete the group
          await client.query(
            'DELETE FROM messages.groups WHERE id = $1',
            [groupId]
          )

          await client.query('COMMIT')

          res.status(204).end()
        } catch (err: any) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }
      }
    } catch (err: any) {
      console.error('[messaging] Error deleting/archiving group:', err)
      res.status(500).json({ error: 'Failed to delete/archive group' })
    }
  })

  // POST /messages/:messageId/attachments - Add attachment to message (MUST be before /:messageId)
  router.post('/:messageId/attachments', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId
    const { file_url, file_path, thumbnail_url, file_name, file_size, mime_type, file_type, width, height, duration, display_order } = req.body

    if (!file_url || !file_type) {
      return res.status(400).json({ error: 'file_url and file_type required' })
    }

    // Validate file_type
    if (!['image', 'video', 'audio', 'document', 'other'].includes(file_type)) {
      return res.status(400).json({ error: 'file_type must be one of: image, video, audio, document, other' })
    }

    try {
      // Verify user has access to this message
      const messageCheck = await pool.query(
        `SELECT sender_id, recipient_id, group_id FROM messages.messages WHERE id = $1
         AND (sender_id = $2 OR recipient_id = $2 OR group_id IN (
           SELECT group_id FROM messages.group_members WHERE user_id = $2
         ))`,
        [messageId, userId]
      )
      if (messageCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found or access denied' })
      }

      // Insert attachment
      const insertQuery = `
        INSERT INTO messages.message_attachments (
          message_id, file_url, file_path, thumbnail_url, file_name, file_size,
          mime_type, file_type, width, height, duration, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, message_id, file_url, file_path, thumbnail_url, file_name,
                  file_size, mime_type, file_type, width, height, duration,
                  display_order, created_at
      `
      const { rows } = await pool.query(insertQuery, [
        messageId, file_url, file_path || null, thumbnail_url || null,
        file_name || null, file_size || null, mime_type || null, file_type,
        width || null, height || null, duration || null, display_order || 0
      ])

      res.status(201).json(rows[0])
    } catch (err: any) {
      console.error('[messaging] Error adding message attachment:', err)
      res.status(500).json({ error: 'Failed to add attachment' })
    }
  })

  // GET /messages/:messageId/attachments - Get attachments for message (MUST be before /:messageId)
  router.get('/:messageId/attachments', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      // Verify user has access to this message
      const messageCheck = await pool.query(
        `SELECT 1 FROM messages.messages WHERE id = $1
         AND (sender_id = $2 OR recipient_id = $2 OR group_id IN (
           SELECT group_id FROM messages.group_members WHERE user_id = $2
         ))`,
        [messageId, userId]
      )
      if (messageCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found or access denied' })
      }

      const query = `
        SELECT id, message_id, file_url, file_path, thumbnail_url, file_name,
               file_size, mime_type, file_type, width, height, duration,
               display_order, created_at
        FROM messages.message_attachments
        WHERE message_id = $1
        ORDER BY display_order ASC, created_at ASC
      `
      const { rows } = await pool.query(query, [messageId])

      res.json({ attachments: rows })
    } catch (err) {
      console.error('[messaging] Error fetching message attachments:', err)
      res.status(500).json({ error: 'Failed to fetch attachments' })
    }
  })

  /**
   * Open-ended emoji / reaction text: no allowlist.
   * Rules: NFC trim, 1–32 Unicode code points, no control chars, reject long ASCII-alnum “blob” junk.
   */
  function normalizeReactionEmoji(raw: unknown): string | null {
    const s = String(raw ?? "")
      .normalize("NFC")
      .trim();
    if (!s) return null;
    const cps = [...s];
    if (cps.length === 0 || cps.length > 32) return null;
    if (/[\u0000-\u001F\u007F]/.test(s)) return null;
    // Plain ASCII words / tokens (not emoji) — likely abuse, not a reaction.
    if (/^[\sA-Za-z0-9._\-:]{4,32}$/.test(s)) return null;
    return s;
  }

  async function assertMessageVisibleToUser(messageId: string, userId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM messages.messages m
       WHERE m.id = $1::uuid
         AND m.deleted_at IS NULL
         AND (
           m.recipient_id = $2::uuid OR m.sender_id = $2::uuid OR EXISTS (
             SELECT 1 FROM messages.group_members gm
             WHERE gm.group_id = m.group_id AND gm.user_id = $2::uuid
           )
         )
       LIMIT 1`,
      [messageId, userId],
    );
    return rows.length > 0;
  }

  /** Participant can see thread row (includes soft-deleted / recalled); used for hide-for-me. */
  async function assertUserCanAccessMessage(messageId: string, userId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM messages.messages m
       WHERE m.id = $1::uuid
         AND (
           m.recipient_id = $2::uuid OR m.sender_id = $2::uuid OR EXISTS (
             SELECT 1 FROM messages.group_members gm
             WHERE gm.group_id = m.group_id AND gm.user_id = $2::uuid
           )
         )
       LIMIT 1`,
      [messageId, userId],
    );
    return rows.length > 0;
  }

  // POST /messages/:messageId/reactions — add emoji reaction (does not create a new message or thread)
  router.post('/:messageId/reactions', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params;
    const userId = req.userId!;
    const emoji = normalizeReactionEmoji((req.body as { emoji?: unknown }).emoji);
    if (!emoji) return res.status(400).json({ error: "emoji required (string, max 32 chars)" });
    if (!ROUTE_UUID_RE.test(messageId)) return res.status(400).json({ error: "invalid message id" });
    try {
      const ok = await assertMessageVisibleToUser(messageId, userId);
      if (!ok) return res.status(404).json({ error: "Message not found" });
      await pool.query(
        `INSERT INTO messages.message_reactions (message_id, user_id, emoji)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, userId, emoji],
      );
      const keys = await threadCacheKeysForMessageId(messageId);
      await bustThreadCachesAfterWrite(keys);
      return res.status(201).json({ ok: true, message_id: messageId, emoji });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01" || code === "42704") {
        return res.status(501).json({
          error: "message_reactions unavailable",
          hint: "Apply infra/db/21-messaging-message-reactions.sql on the messaging database",
        });
      }
      console.error("[messaging] reaction POST", e);
      return res.status(500).json({ error: "Failed to add reaction" });
    }
  });

  // POST /messages/:messageId/hide-for-me — omit message from this user's thread view only (row unchanged for others)
  router.post('/:messageId/hide-for-me', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params;
    const userId = req.userId!;
    if (!ROUTE_UUID_RE.test(messageId)) return res.status(400).json({ error: "invalid message id" });
    try {
      const ok = await assertUserCanAccessMessage(messageId, userId);
      if (!ok) return res.status(404).json({ error: "Message not found" });
      await pool.query(
        `INSERT INTO messages.user_hidden_messages (user_id, message_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT (user_id, message_id) DO NOTHING`,
        [userId, messageId],
      );
      const keys = await threadCacheKeysForMessageId(messageId);
      await bustThreadCachesAfterWrite(keys);
      return res.status(204).end();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01") {
        return res.status(501).json({
          error: "user_hidden_messages unavailable",
          hint: "Apply infra/db/23-messaging-user-hidden-messages.sql on the messaging database",
        });
      }
      console.error("[messaging] hide-for-me POST", e);
      return res.status(500).json({ error: "Failed to hide message" });
    }
  });

  // DELETE /messages/:messageId/hide-for-me — reverse hide-for-me (show message again in my thread)
  router.delete('/:messageId/hide-for-me', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params;
    const userId = req.userId!;
    if (!ROUTE_UUID_RE.test(messageId)) return res.status(400).json({ error: "invalid message id" });
    try {
      await pool.query(
        `DELETE FROM messages.user_hidden_messages
         WHERE user_id = $1::uuid AND message_id = $2::uuid`,
        [userId, messageId],
      );
      const keys = await threadCacheKeysForMessageId(messageId);
      await bustThreadCachesAfterWrite(keys);
      return res.status(204).end();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01") {
        return res.status(501).json({
          error: "user_hidden_messages unavailable",
          hint: "Apply infra/db/23-messaging-user-hidden-messages.sql on the messaging database",
        });
      }
      console.error("[messaging] hide-for-me DELETE", e);
      return res.status(500).json({ error: "Failed to unhide message" });
    }
  });

  // DELETE /messages/:messageId/reactions?emoji=… — remove current user's reaction for that emoji
  router.delete('/:messageId/reactions', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params;
    const userId = req.userId!;
    const qEmoji = req.query.emoji;
    const emoji = normalizeReactionEmoji(Array.isArray(qEmoji) ? qEmoji[0] : qEmoji);
    if (!emoji) return res.status(400).json({ error: "query param emoji required" });
    if (!ROUTE_UUID_RE.test(messageId)) return res.status(400).json({ error: "invalid message id" });
    try {
      const ok = await assertMessageVisibleToUser(messageId, userId);
      if (!ok) return res.status(404).json({ error: "Message not found" });
      const del = await pool.query(
        `DELETE FROM messages.message_reactions
         WHERE message_id = $1::uuid AND user_id = $2::uuid AND emoji = $3`,
        [messageId, userId, emoji],
      );
      const keys = await threadCacheKeysForMessageId(messageId);
      await bustThreadCachesAfterWrite(keys);
      return res.json({ ok: true, removed: (del.rowCount ?? 0) > 0 });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01" || code === "42704") {
        return res.status(501).json({
          error: "message_reactions unavailable",
          hint: "Apply infra/db/21-messaging-message-reactions.sql on the messaging database",
        });
      }
      console.error("[messaging] reaction DELETE", e);
      return res.status(500).json({ error: "Failed to remove reaction" });
    }
  });

  // GET /messages/:messageId - Get message details
  router.get('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      const query = `
        SELECT 
          m.id,
          m.sender_id,
          m.recipient_id,
          m.group_id,
          m.parent_message_id,
          m.thread_id,
          m.message_type,
          m.subject,
          CASE
            WHEN m.deleted_at IS NOT NULL THEN 'Message removed'
            WHEN m.recalled_at IS NOT NULL THEN COALESCE(m.content, '[Message recalled]')
            ELSE COALESCE(m.content, '')
          END AS content,
          m.recalled_at,
          m.is_read,
          m.created_at,
          m.updated_at,
          m.deleted_at,
          m.edited_at,
          g.name as group_name
        FROM messages.messages m
        LEFT JOIN messages.groups g ON m.group_id = g.id
        WHERE m.id = $1
        AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
          SELECT group_id FROM messages.group_members WHERE user_id = $2
        ))
      `
      const { rows } = await pool.query(query, [messageId, userId])

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }

      res.json(rows[0])
    } catch (err) {
      console.error('[messaging] Error fetching message:', err)
      res.status(500).json({ error: 'Failed to fetch message' })
    }
  })

  // POST /messages/:messageId/reply - Reply to message (creates thread, WhatsApp-style)
  router.post('/:messageId/reply', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const { message_type, subject, content } = req.body
    const sender_id = req.userId

    if (!content) {
      return res.status(400).json({ error: 'content required' })
    }

    try {
      // Get parent message to determine recipient/group and include full parent details for reply context
      const parentQuery = await pool.query(
        `SELECT id, sender_id, recipient_id, group_id, subject, content, message_type, created_at
         FROM messages.messages WHERE id = $1`,
        [messageId]
      )
      if (parentQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Parent message not found' })
      }

      const parent = parentQuery.rows[0]
      const group_id = parent.group_id
      const UUID_PEER_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      let recipient_id: string | null = null
      let replyThreadId: string | null = null
      if (group_id) {
        recipient_id = null
        replyThreadId = null
      } else {
        const ps = String(parent.sender_id)
        const pr = parent.recipient_id != null ? String(parent.recipient_id) : ""
        const peer = ps === String(sender_id) ? pr : ps
        recipient_id = peer && UUID_PEER_RE.test(peer) ? peer : null
        if (recipient_id) {
          replyThreadId = stableHumanDmThreadId(String(sender_id), recipient_id)
        }
      }

      // Insert reply with parent_message_id set (WhatsApp-style reply)
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id, thread_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const subj = group_id
        ? String(subject || "").trim() || `Re: ${parent.subject || "Message"}`
        : ""
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id,
        group_id,
        messageId, // parent_message_id - links to the message being replied to
        replyThreadId,
        message_type || 'General',
        subj,
        content,
      ])
      const message = rows[0]

      // Fetch parent message details to include in response (for UI to show "replying to...")
      const parentDetails = {
        id: parent.id,
        sender_id: parent.sender_id,
        subject: parent.subject,
        content: parent.content.substring(0, 100) + (parent.content.length > 100 ? '...' : ''), // Preview
        message_type: parent.message_type,
        created_at: parent.created_at,
      }

      const producer = await getKafkaProducer()
      const kafkaKey = group_id || recipient_id || messageId
      const createdAt =
        message.created_at instanceof Date ? message.created_at.toISOString() : String(message.created_at)
      await sendMessagingEvent(producer, kafkaKey, {
        metadata: buildMetadata({
          event_type: 'MessageReplied',
          aggregate_id: message.id,
          aggregate_type: 'message',
        }),
        message_id: message.id,
        parent_message_id: messageId,
        sender_id,
        recipient_id: recipient_id || '',
        thread_id: message.thread_id || '',
        content,
        created_at: createdAt,
      })

      await bustThreadCachesAfterWrite([replyThreadId, group_id, message.thread_id])

      // Return reply with parent message context (WhatsApp-style)
      res.status(201).json({
        ...message,
        parent_message: parentDetails, // Include parent message preview in response
      })
    } catch (err: any) {
      console.error('[messaging] Error replying to message:', err)
      res.status(500).json({ error: 'Failed to reply to message' })
    }
  })

  // PUT /messages/:messageId - Update message (sender only)
  router.put('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const { subject, content } = req.body as { subject?: unknown; content?: unknown }
    const userId = req.userId

    try {
      const checkQuery = await pool.query(
        `SELECT sender_id, subject AS cur_subject, content AS cur_content, deleted_at
         FROM messages.messages WHERE id = $1::uuid`,
        [messageId],
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      const row = checkQuery.rows[0] as {
        sender_id: string
        cur_subject: string | null
        cur_content: string | null
        deleted_at: string | null
      }
      if (row.sender_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own messages' })
      }
      if (row.deleted_at) {
        return res.status(400).json({ error: 'Cannot edit a deleted message' })
      }

      const nextSubject = subject !== undefined ? String(subject) : row.cur_subject ?? ''
      const nextContent = content !== undefined ? String(content) : row.cur_content ?? ''
      const contentChanged =
        String(nextContent) !== String(row.cur_content ?? '') || String(nextSubject) !== String(row.cur_subject ?? '')

      const updateQuery = `
        UPDATE messages.messages
        SET subject = $1,
            content = $2,
            updated_at = now(),
            edited_at = CASE WHEN $4::boolean THEN now() ELSE edited_at END
        WHERE id = $3::uuid AND deleted_at IS NULL
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at, edited_at, deleted_at
      `
      const { rows } = await pool.query(updateQuery, [
        nextSubject,
        nextContent,
        messageId,
        contentChanged,
      ])
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      const keys = await threadCacheKeysForMessageId(messageId)
      await bustThreadCachesAfterWrite(keys)
      res.json(rows[0])
    } catch (err) {
      console.error('[messaging] Error updating message:', err)
      res.status(500).json({ error: 'Failed to update message' })
    }
  })

  // POST /messages/:messageId/recall - Recall message (sender only; replaces content with [Message recalled])
  router.post('/:messageId/recall', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId
    try {
      const check = await pool.query(
        'SELECT sender_id FROM messages.messages WHERE id = $1',
        [messageId]
      )
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      if (check.rows[0].sender_id !== userId) {
        return res.status(403).json({ error: 'Only the sender can recall a message' })
      }
      await pool.query(
        `UPDATE messages.messages SET content = '[Message recalled]', recalled_at = now(), updated_at = now() WHERE id = $1`,
        [messageId]
      )
      const keys = await threadCacheKeysForMessageId(messageId)
      await bustThreadCachesAfterWrite(keys)
      res.json({ id: messageId, recalled: true })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      if (code === '42703') {
        console.error('[messaging] Recall message: missing column recalled_at (501)', { code })
        return res.status(501).json({ error: 'recalled_at not available; run migration 04-social-schema-archive-recall-kickban.sql' })
      }
      console.error('[messaging] Error recalling message:', { code, message: err?.message, status: 500 })
      res.status(500).json({ error: 'Failed to recall message' })
    }
  })

  // DELETE /messages/:messageId — soft-delete (sender only); row kept for reply/reaction integrity
  router.delete('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      const checkQuery = await pool.query(
        `SELECT sender_id, deleted_at FROM messages.messages WHERE id = $1::uuid`,
        [messageId],
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      const chk = checkQuery.rows[0] as { sender_id: string; deleted_at: string | null }
      if (chk.sender_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own messages' })
      }
      if (chk.deleted_at) {
        return res.status(204).end()
      }

      await pool.query(
        `UPDATE messages.messages
         SET deleted_at = now(),
             content = '',
             subject = '',
             updated_at = now()
         WHERE id = $1::uuid AND sender_id = $2::uuid AND deleted_at IS NULL`,
        [messageId, userId],
      )

      const producer = await getKafkaProducer()
      const deletedAt = new Date().toISOString()
      await sendMessagingEvent(producer, messageId, {
        metadata: buildMetadata({
          event_type: 'MessageDeleted',
          aggregate_id: messageId,
          aggregate_type: 'message',
        }),
        message_id: messageId,
        deleted_at: deletedAt,
        soft: true,
      })

      const keys = await threadCacheKeysForMessageId(messageId)
      await bustThreadCachesAfterWrite(keys)

      res.status(204).end()
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === '42703') {
        return res.status(501).json({
          error: 'soft delete unavailable',
          hint: 'Apply infra/db/22-messaging-message-deleted-edited.sql on the messaging database',
        })
      }
      console.error('[messaging] Error deleting message:', err)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  // GET /messages/thread/:threadId/hidden-for-me — messages this user hid in this thread (recovery list)
  router.get('/thread/:threadId/hidden-for-me', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params;
    const userId = req.userId!;
    const includeArchived = req.query.includeArchived === "true";

    const { loadKey, responseThreadId } = await resolveThreadLoadKey(threadId, userId);

    if (!includeArchived) {
      try {
        const { rows: archRows } = await pool.query(
          `SELECT 1 FROM messages.user_archived_threads
           WHERE user_id = $1 AND thread_id::text IN ($2::text, $3::text) LIMIT 1`,
          [userId, threadId, loadKey],
        );
        if (archRows.length > 0) {
          return res.status(404).json({
            error: "Thread archived for you; pass includeArchived=true to load",
          });
        }
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code !== "42P01") {
          console.error("[messaging] archived-thread gate failed (hidden-for-me):", e);
          return res.status(500).json({ error: "Failed to load thread" });
        }
      }
    }

    try {
      const hiddenQuery = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.parent_message_id AS reply_to_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN 'Message removed'
                WHEN m.recalled_at IS NOT NULL THEN COALESCE(m.content, '[Message recalled]')
                ELSE COALESCE(m.content, '')
              END AS content,
              m.is_read,
              m.created_at,
              m.updated_at,
              m.deleted_at,
              m.edited_at,
              m.recalled_at,
              NULLIF(TRIM(COALESCE(su.display_name::text, '')), '') AS sender_display_name,
              NULLIF(TRIM(COALESCE(su.display_username::text, '')), '') AS sender_username,
              NULLIF(TRIM(COALESCE(ru.display_name::text, '')), '') AS recipient_display_name,
              NULLIF(TRIM(COALESCE(ru.display_username::text, '')), '') AS recipient_username,
              CASE WHEN m.parent_message_id IS NOT NULL AND pm.id IS NOT NULL THEN
                json_build_object(
                  'id', pm.id,
                  'sender_id', pm.sender_id,
                  'content_snippet',
                    CASE
                      WHEN pm.deleted_at IS NOT NULL THEN 'Original message removed'
                      WHEN pm.recalled_at IS NOT NULL THEN COALESCE(LEFT(pm.content, 200), '[Message recalled]')
                      ELSE LEFT(COALESCE(pm.content, ''), 200)
                    END,
                  'message_type', pm.message_type,
                  'created_at', pm.created_at,
                  'deleted', to_jsonb(pm.deleted_at IS NOT NULL)
                )
              ELSE NULL
              END AS reply_to_message,
              COALESCE(react.reactions_json, '[]'::json) AS reactions
            FROM messages.messages m
            INNER JOIN messages.user_hidden_messages uhm ON uhm.message_id = m.id AND uhm.user_id = $2::uuid
            LEFT JOIN messages.messages pm ON pm.id = m.parent_message_id
            LEFT JOIN auth.users su ON su.id = m.sender_id
            LEFT JOIN auth.users ru ON ru.id = m.recipient_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(json_agg(json_build_object(
                'emoji', agg.emoji,
                'count', agg.cnt,
                'includes_me', agg.includes_me
              ) ORDER BY agg.emoji), '[]'::json) AS reactions_json
              FROM (
                SELECT r.emoji, COUNT(*)::int AS cnt, BOOL_OR(r.user_id = $2::uuid) AS includes_me
                FROM messages.message_reactions r
                WHERE r.message_id = m.id
                GROUP BY r.emoji
              ) agg
            ) react ON true
            WHERE (
              m.thread_id::text = $1
              OR (
                ${sqlHumanPairConversationId("m")} = $1
                AND ${sqlHumanDirectDmRow("m")}
              )
              OR (
                ${sqlHumanPairConversationId("m")} = $1
                AND ${sqlBookingOrSystemDmRow("m")}
              )
              OR m.group_id::text = $1
            )
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            ORDER BY m.created_at ASC
          `;
      const hiddenNoReact = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.parent_message_id AS reply_to_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN 'Message removed'
                WHEN m.recalled_at IS NOT NULL THEN COALESCE(m.content, '[Message recalled]')
                ELSE COALESCE(m.content, '')
              END AS content,
              m.is_read,
              m.created_at,
              m.updated_at,
              m.deleted_at,
              m.edited_at,
              m.recalled_at,
              NULLIF(TRIM(COALESCE(su.display_name::text, '')), '') AS sender_display_name,
              NULLIF(TRIM(COALESCE(su.display_username::text, '')), '') AS sender_username,
              NULLIF(TRIM(COALESCE(ru.display_name::text, '')), '') AS recipient_display_name,
              NULLIF(TRIM(COALESCE(ru.display_username::text, '')), '') AS recipient_username,
              CASE WHEN m.parent_message_id IS NOT NULL AND pm.id IS NOT NULL THEN
                json_build_object(
                  'id', pm.id,
                  'sender_id', pm.sender_id,
                  'content_snippet',
                    CASE
                      WHEN pm.deleted_at IS NOT NULL THEN 'Original message removed'
                      WHEN pm.recalled_at IS NOT NULL THEN COALESCE(LEFT(pm.content, 200), '[Message recalled]')
                      ELSE LEFT(COALESCE(pm.content, ''), 200)
                    END,
                  'message_type', pm.message_type,
                  'created_at', pm.created_at,
                  'deleted', to_jsonb(pm.deleted_at IS NOT NULL)
                )
              ELSE NULL
              END AS reply_to_message,
              '[]'::json AS reactions
            FROM messages.messages m
            INNER JOIN messages.user_hidden_messages uhm ON uhm.message_id = m.id AND uhm.user_id = $2::uuid
            LEFT JOIN messages.messages pm ON pm.id = m.parent_message_id
            LEFT JOIN auth.users su ON su.id = m.sender_id
            LEFT JOIN auth.users ru ON ru.id = m.recipient_id
            WHERE (
              m.thread_id::text = $1
              OR (
                ${sqlHumanPairConversationId("m")} = $1
                AND ${sqlHumanDirectDmRow("m")}
              )
              OR (
                ${sqlHumanPairConversationId("m")} = $1
                AND ${sqlBookingOrSystemDmRow("m")}
              )
              OR m.group_id::text = $1
            )
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            ORDER BY m.created_at ASC
          `;
      let rows: Record<string, unknown>[];
      try {
        const r = await pool.query(hiddenQuery, [loadKey, userId]);
        rows = r.rows as Record<string, unknown>[];
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "42P01") {
          const r2 = await pool.query(hiddenNoReact, [loadKey, userId]);
          rows = r2.rows as Record<string, unknown>[];
        } else {
          throw e;
        }
      }
      res.json({ thread_id: responseThreadId, messages: rows });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "42P01") {
        return res.status(501).json({
          error: "user_hidden_messages unavailable",
          hint: "Apply infra/db/23-messaging-user-hidden-messages.sql on the messaging database",
        });
      }
      console.error("[messaging] Error fetching hidden-for-me:", err);
      res.status(500).json({ error: "Failed to load hidden messages" });
    }
  });

  // POST /messages/thread/:threadId/mark-read — mark all inbound messages in thread read (fixes inbox unread badge).
  router.post("/thread/:threadId/mark-read", async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params;
    const userId = req.userId!;
    try {
      const { loadKey } = await resolveThreadLoadKey(threadId, userId);
      const groupRes = await pool.query(
        `UPDATE messages.messages m
         SET is_read = true, updated_at = now()
         WHERE m.group_id::text = $1::text
           AND m.sender_id <> $2::uuid
           AND COALESCE(m.is_read, false) = false`,
        [loadKey, userId],
      );
      if ((groupRes.rowCount ?? 0) > 0) {
        await bustThreadCachesAfterWrite([loadKey]);
        return res.json({ updated: groupRes.rowCount ?? 0, mode: "group" });
      }
      const pairExpr = sqlHumanPairConversationId("m");
      const dmRes = await pool.query(
        `UPDATE messages.messages m
         SET is_read = true, updated_at = now()
         WHERE m.recipient_id = $2::uuid
           AND COALESCE(m.is_read, false) = false
           AND m.group_id IS NULL
           AND (
             m.thread_id::text IN ($1::text, $3::text)
             OR (${pairExpr})::text IN ($1::text, $3::text)
           )`,
        [loadKey, userId, threadId],
      );
      await bustThreadCachesAfterWrite([loadKey, threadId]);
      res.json({ updated: dmRes.rowCount ?? 0, mode: "dm" });
    } catch (err) {
      console.error("[messaging] mark thread read failed", err);
      res.status(500).json({ error: "Failed to mark thread read" });
    }
  });

  // GET /messages/thread/:threadId - Get full thread/conversation
  router.get('/thread/:threadId', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    const includeArchived = req.query.includeArchived === 'true'

    const { loadKey, responseThreadId } = await resolveThreadLoadKey(threadId, userId!)

    if (!includeArchived) {
      try {
        const { rows: archRows } = await pool.query(
          `SELECT 1 FROM messages.user_archived_threads
           WHERE user_id = $1 AND thread_id::text IN ($2::text, $3::text) LIMIT 1`,
          [userId, threadId, loadKey],
        )
        if (archRows.length > 0) {
          return res.status(404).json({
            error: 'Thread archived for you; pass includeArchived=true to load',
          })
        }
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code
        if (code !== '42P01') {
          console.error('[messaging] archived-thread gate failed:', e)
          return res.status(500).json({ error: 'Failed to load thread' })
        }
      }
    }

    const cacheKey = makeThreadKey(loadKey, includeArchived)
    const result = await cached(
      redis,
      cacheKey,
      60_000, // 1 minute cache
      async () => {
        try {
          const query = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.parent_message_id AS reply_to_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN 'Message removed'
                WHEN m.recalled_at IS NOT NULL THEN COALESCE(m.content, '[Message recalled]')
                ELSE COALESCE(m.content, '')
              END AS content,
              m.is_read,
              m.created_at,
              m.updated_at,
              m.deleted_at,
              m.edited_at,
              m.recalled_at,
              NULLIF(TRIM(COALESCE(su.display_name::text, '')), '') AS sender_display_name,
              NULLIF(TRIM(COALESCE(su.display_username::text, '')), '') AS sender_username,
              NULLIF(TRIM(COALESCE(ru.display_name::text, '')), '') AS recipient_display_name,
              NULLIF(TRIM(COALESCE(ru.display_username::text, '')), '') AS recipient_username,
              CASE WHEN m.parent_message_id IS NOT NULL AND pm.id IS NOT NULL THEN
                json_build_object(
                  'id', pm.id,
                  'sender_id', pm.sender_id,
                  'content_snippet',
                    CASE
                      WHEN pm.deleted_at IS NOT NULL THEN 'Original message removed'
                      WHEN pm.recalled_at IS NOT NULL THEN COALESCE(LEFT(pm.content, 200), '[Message recalled]')
                      ELSE LEFT(COALESCE(pm.content, ''), 200)
                    END,
                  'message_type', pm.message_type,
                  'created_at', pm.created_at,
                  'deleted', to_jsonb(pm.deleted_at IS NOT NULL)
                )
              ELSE NULL
              END AS reply_to_message,
              COALESCE(react.reactions_json, '[]'::json) AS reactions
            FROM messages.messages m
            LEFT JOIN messages.messages pm ON pm.id = m.parent_message_id
            LEFT JOIN auth.users su ON su.id = m.sender_id
            LEFT JOIN auth.users ru ON ru.id = m.recipient_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(json_agg(json_build_object(
                'emoji', agg.emoji,
                'count', agg.cnt,
                'includes_me', agg.includes_me
              ) ORDER BY agg.emoji), '[]'::json) AS reactions_json
              FROM (
                SELECT r.emoji, COUNT(*)::int AS cnt, BOOL_OR(r.user_id = $2::uuid) AS includes_me
                FROM messages.message_reactions r
                WHERE r.message_id = m.id
                GROUP BY r.emoji
              ) agg
            ) react ON true
            WHERE (
              m.thread_id::text = $1
              OR (
                ${sqlHumanPairConversationId('m')} = $1
                AND ${sqlHumanDirectDmRow('m')}
              )
              OR (
                ${sqlHumanPairConversationId('m')} = $1
                AND ${sqlBookingOrSystemDmRow('m')}
              )
              OR m.group_id::text = $1
            )
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            AND NOT EXISTS (
              SELECT 1 FROM messages.user_hidden_messages uh
              WHERE uh.user_id = $2::uuid AND uh.message_id = m.id
            )
            ORDER BY m.created_at ASC
          `
          const threadQueryNoReactions = `
            SELECT 
              m.id,
              m.sender_id,
              m.recipient_id,
              m.group_id,
              m.parent_message_id,
              m.parent_message_id AS reply_to_message_id,
              m.thread_id,
              m.message_type,
              m.subject,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN 'Message removed'
                WHEN m.recalled_at IS NOT NULL THEN COALESCE(m.content, '[Message recalled]')
                ELSE COALESCE(m.content, '')
              END AS content,
              m.is_read,
              m.created_at,
              m.updated_at,
              m.deleted_at,
              m.edited_at,
              m.recalled_at,
              NULLIF(TRIM(COALESCE(su.display_name::text, '')), '') AS sender_display_name,
              NULLIF(TRIM(COALESCE(su.display_username::text, '')), '') AS sender_username,
              NULLIF(TRIM(COALESCE(ru.display_name::text, '')), '') AS recipient_display_name,
              NULLIF(TRIM(COALESCE(ru.display_username::text, '')), '') AS recipient_username,
              CASE WHEN m.parent_message_id IS NOT NULL AND pm.id IS NOT NULL THEN
                json_build_object(
                  'id', pm.id,
                  'sender_id', pm.sender_id,
                  'content_snippet',
                    CASE
                      WHEN pm.deleted_at IS NOT NULL THEN 'Original message removed'
                      WHEN pm.recalled_at IS NOT NULL THEN COALESCE(LEFT(pm.content, 200), '[Message recalled]')
                      ELSE LEFT(COALESCE(pm.content, ''), 200)
                    END,
                  'message_type', pm.message_type,
                  'created_at', pm.created_at,
                  'deleted', to_jsonb(pm.deleted_at IS NOT NULL)
                )
              ELSE NULL
              END AS reply_to_message,
              '[]'::json AS reactions
            FROM messages.messages m
            LEFT JOIN messages.messages pm ON pm.id = m.parent_message_id
            LEFT JOIN auth.users su ON su.id = m.sender_id
            LEFT JOIN auth.users ru ON ru.id = m.recipient_id
            WHERE (
              m.thread_id::text = $1
              OR (
                ${sqlHumanPairConversationId('m')} = $1
                AND ${sqlHumanDirectDmRow('m')}
              )
              OR (
                ${sqlHumanPairConversationId('m')} = $1
                AND ${sqlBookingOrSystemDmRow('m')}
              )
              OR m.group_id::text = $1
            )
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            AND NOT EXISTS (
              SELECT 1 FROM messages.user_hidden_messages uh
              WHERE uh.user_id = $2::uuid AND uh.message_id = m.id
            )
            ORDER BY m.created_at ASC
          `
          let rows: Record<string, unknown>[];
          try {
            const r = await pool.query(query, [loadKey, userId]);
            rows = r.rows as Record<string, unknown>[];
          } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code === "42P01") {
              const r2 = await pool.query(threadQueryNoReactions, [loadKey, userId]);
              rows = r2.rows as Record<string, unknown>[];
            } else {
              throw e;
            }
          }

          return {
            thread_id: responseThreadId,
            messages: rows,
          }
        } catch (err) {
          console.error('[messaging] Error fetching thread:', err)
          throw err
        }
      }
    )

    res.json(result)
  })

  // POST /messages/:messageId/read - Mark as read
  router.post('/:messageId/read', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      // Insert read receipt
      await pool.query(
        `INSERT INTO messages.message_reads (message_id, user_id, read_by_sender)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()`,
        [messageId, userId]
      )

      await pool.query(
        `UPDATE messages.messages SET is_read = true, updated_at = now()
         WHERE id = $1::uuid AND recipient_id = $2::uuid`,
        [messageId, userId],
      );

      const keys = await threadCacheKeysForMessageId(messageId);
      await bustThreadCachesAfterWrite(keys);

      // Get updated message
      const { rows } = await pool.query(
        'SELECT id, is_read, updated_at FROM messages.messages WHERE id = $1',
        [messageId]
      )

      const readAt = new Date().toISOString()

      const producer = await getKafkaProducer()
      await sendMessagingEvent(producer, messageId, {
        metadata: buildMetadata({
          event_type: 'MessageMarkedRead',
          aggregate_id: messageId,
          aggregate_type: 'message',
        }),
        message_id: messageId,
        user_id: userId!,
        read_at: readAt,
      })

      res.json({
        id: messageId,
        is_read: rows[0]?.is_read || true,
        read_at: readAt,
      })
    } catch (err) {
      console.error('[messaging] Error marking message as read:', err)
      res.status(500).json({ error: 'Failed to mark message as read' })
    }
  })


  return router
}
