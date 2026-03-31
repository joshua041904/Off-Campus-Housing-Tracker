import { Router, type Request, type Response } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { cached, makeMessagesKey, makeThreadKey } from '../lib/cache.js'
import { pool } from '../lib/db.js'
import { kafka } from '@common/utils/kafka'
import { buildMetadata, sendMessagingEvent } from '../kafkaMessagingEvents.js'

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

export default function messagesRouter(redis: Redis | null, cpuCores: number) {
  const router: Router = Router()

  // GET /messages - List user's messages (inbox)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.userId
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const type = req.query.type as string | undefined
    const offset = (page - 1) * limit

    const cacheKey = makeMessagesKey(userId!, page, limit, type)
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
                ${type ? 'AND message_type = $2' : ''}
                
                UNION ALL
                
                SELECT * FROM messages.messages 
                WHERE group_id = ANY($${type ? '3' : '2'}::uuid[])
                AND (thread_id IS NULL OR thread_id NOT IN (SELECT thread_id FROM messages.user_deleted_threads WHERE user_id = $1))
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
                ${type ? 'AND message_type = $2' : ''}
                
                UNION ALL
                
                SELECT id FROM messages.messages 
                WHERE group_id = ANY($${type ? '3' : '2'}::uuid[])
                ${type ? 'AND message_type = $2' : ''}
              ) m
            `
            countParams = type ? [userId, type, groupIds] : [userId, groupIds]
          } else {
            countQuery = `
              SELECT COUNT(*) as total
              FROM messages.messages m
              WHERE m.recipient_id = $1
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

  // POST /messages - Send new message (direct or group)
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const { recipient_id, group_id, message_type, subject, content, parent_message_id } = req.body
    const sender_id = req.userId

    // Validate: must have either recipient_id (direct) or group_id (group), but not both
    if ((!recipient_id && !group_id) || (recipient_id && group_id)) {
      return res.status(400).json({
        error: 'Either recipient_id (direct message) or group_id (group message) required, but not both',
      })
    }

    if (!message_type || !subject || !content) {
      return res.status(400).json({
        error: 'message_type, subject, and content required',
      })
    }

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

    try {
      // Insert message into database
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id || null,
        group_id || null,
        parent_message_id || null,
        message_type,
        subject,
        content,
      ])
      const message = rows[0]

      const producer = await getKafkaProducer()
      const kafkaKey = group_id || recipient_id || message.id
      const createdAt =
        message.created_at instanceof Date ? message.created_at.toISOString() : String(message.created_at)
      await sendMessagingEvent(producer, kafkaKey, {
        metadata: buildMetadata({
          event_type: 'MessageSent',
          aggregate_id: message.id,
          aggregate_type: 'message',
        }),
        message_id: message.id,
        sender_id,
        recipient_id: recipient_id || '',
        thread_id: message.thread_id || '',
        message_type,
        subject,
        content,
        created_at: createdAt,
      })

      res.status(201).json(message)
    } catch (err: any) {
      console.error('[messaging] Error creating message:', err)
      res.status(500).json({ error: 'Failed to create message' })
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

  // POST /messages/thread/:threadId/archive - Archive chat (hide from inbox, still accessible)
  router.post('/thread/:threadId/archive', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    try {
      // Verify user has access to this thread
      const access = await pool.query(
        `SELECT 1 FROM messages.messages WHERE thread_id = $1
         AND (recipient_id = $2 OR sender_id = $2 OR group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $2))
         LIMIT 1`,
        [threadId, userId]
      )
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Thread not found' })
      }
      await pool.query(
        `INSERT INTO messages.user_archived_threads (user_id, thread_id)
         VALUES ($1, $2) ON CONFLICT (user_id, thread_id) DO NOTHING`,
        [userId, threadId]
      )
      res.status(201).json({ thread_id: threadId, archived: true })
    } catch (err: any) {
      const code = (err as { code?: string })?.code
      if (code === '42P01') {
        console.error('[messaging] Archive thread: missing table user_archived_threads (501)', { code })
        return res.status(501).json({ error: 'user_archived_threads table not found; run migration 04-social-schema-archive-recall-kickban.sql' })
      }
      console.error('[messaging] Error archiving thread:', { code, message: err?.message, status: 500 })
      res.status(500).json({ error: 'Failed to archive thread' })
    }
  })

  // POST /messages/thread/:threadId/delete - Delete chat for me (hide thread from list; messages stay for others)
  router.post('/thread/:threadId/delete', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId
    try {
      const access = await pool.query(
        `SELECT 1 FROM messages.messages WHERE thread_id = $1
         AND (recipient_id = $2 OR sender_id = $2 OR group_id IN (SELECT group_id FROM messages.group_members WHERE user_id = $2))
         LIMIT 1`,
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
          m.content,
          m.is_read,
          m.created_at,
          m.updated_at,
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
      // For group messages, recipient_id must be null (check constraint)
      // For P2P messages, set recipient_id to the other party
      const group_id = parent.group_id
      const recipient_id = group_id ? null : (parent.recipient_id || (parent.sender_id === sender_id ? null : parent.sender_id))

      // Insert reply with parent_message_id set (WhatsApp-style reply)
      const insertQuery = `
        INSERT INTO messages.messages (
          sender_id, recipient_id, group_id, parent_message_id,
          message_type, subject, content, is_read
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [
        sender_id,
        recipient_id,
        group_id,
        messageId, // parent_message_id - links to the message being replied to
        message_type || 'General',
        subject || `Re: ${parent.subject || 'Message'}`,
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
    const { subject, content } = req.body
    const userId = req.userId

    try {
      // Verify sender owns the message
      const checkQuery = await pool.query(
        'SELECT sender_id FROM messages.messages WHERE id = $1',
        [messageId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }
      if (checkQuery.rows[0].sender_id !== userId) {
        return res.status(403).json({ error: 'You can only edit your own messages' })
      }

      const updateQuery = `
        UPDATE messages.messages
        SET subject = COALESCE($1, subject),
            content = COALESCE($2, content),
            updated_at = now()
        WHERE id = $3
        RETURNING id, sender_id, recipient_id, group_id, parent_message_id, thread_id,
                  message_type, subject, content, is_read, created_at, updated_at
      `
      const { rows } = await pool.query(updateQuery, [subject, content, messageId])

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

  // DELETE /messages/:messageId - Delete message (sender or recipient)
  router.delete('/:messageId', async (req: AuthedRequest, res: Response) => {
    const { messageId } = req.params
    const userId = req.userId

    try {
      // Verify user is sender or recipient
      const checkQuery = await pool.query(
        `SELECT sender_id, recipient_id, group_id FROM messages.messages WHERE id = $1
         AND (sender_id = $2 OR recipient_id = $2 OR group_id IN (
           SELECT group_id FROM messages.group_members WHERE user_id = $2
         ))`,
        [messageId, userId]
      )
      if (checkQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' })
      }

      await pool.query('DELETE FROM messages.messages WHERE id = $1', [messageId])

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
      })

      res.status(204).end()
    } catch (err) {
      console.error('[messaging] Error deleting message:', err)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  // GET /messages/thread/:threadId - Get full thread/conversation
  router.get('/thread/:threadId', async (req: AuthedRequest, res: Response) => {
    const { threadId } = req.params
    const userId = req.userId

    const cacheKey = makeThreadKey(threadId)
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
              m.thread_id,
              m.message_type,
              m.subject,
              m.content,
              m.is_read,
              m.created_at,
              m.updated_at
            FROM messages.messages m
            WHERE m.thread_id = $1
            AND (m.recipient_id = $2 OR m.sender_id = $2 OR m.group_id IN (
              SELECT group_id FROM messages.group_members WHERE user_id = $2
            ))
            ORDER BY m.created_at ASC
          `
          const { rows } = await pool.query(query, [threadId, userId])

          return {
            thread_id: threadId,
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
