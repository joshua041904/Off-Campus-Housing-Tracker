/**
 * Phase C: structural HTTP activation (messages + forum) with mocked pg pool + Kafka producer.
 */
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Express } from 'express'
import { stableHumanDmThreadId } from '../src/lib/dm-thread-id.js'

const userId = randomUUID()
const recipientId = randomUUID()
const messageId = randomUUID()
const groupId = randomUUID()
const threadId = randomUUID()
const postId = randomUUID()
const commentId = randomUUID()
const otherUserId = randomUUID()

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}))

vi.mock('../src/lib/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => poolQuery(...args),
      release: vi.fn(),
    }),
  },
}))

const kafkaSend = vi.fn().mockResolvedValue(undefined)
const kafkaConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@common/utils/kafka', () => ({
  kafka: {
    producer: () => ({
      connect: kafkaConnect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: kafkaSend,
    }),
  },
}))

vi.mock('@common/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@common/utils')>()
  return {
    ...actual,
    createHttpConcurrencyGuard: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  }
})

vi.mock('@common/utils/otel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@common/utils/otel')>()
  return {
    ...actual,
    tracingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    mountDebugTraceHeaders: () => {},
    buildKafkaMessageHeaders: () => ({}),
    withKafkaProduceSpan: async (_n: string, _a: Record<string, string>, fn: () => Promise<void>) => {
      await fn()
    },
  }
})

function defaultPoolHandler(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount?: number }> {
  const norm = sql.replace(/\s+/g, ' ').trim()

  if (norm === 'BEGIN' || norm === 'COMMIT' || norm === 'ROLLBACK') {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.message_reads')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.user_archived_threads')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.user_deleted_threads')) {
    return Promise.resolve({ rows: [] })
  }

  // POST /messages/thread/:id/archive|delete — participant access (SELECT 1 WHERE EXISTS …)
  if (
    norm.includes('SELECT 1 WHERE') &&
    norm.includes('FROM messages.messages m') &&
    norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
  ) {
    const tid = String(params[0])
    const uid = String(params[1])
    if (tid === threadId && (uid === userId || uid === recipientId)) {
      return Promise.resolve({ rows: [{ '?column?': 1 }] })
    }
    return Promise.resolve({ rows: [] })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages WHERE thread_id::text = $1 OR group_id::text = $1 LIMIT 1')
  ) {
    return Promise.resolve({ rows: [] })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages WHERE thread_id = $1') &&
    norm.includes('LIMIT 1') &&
    (norm.includes('recipient_id = $2') || norm.includes('sender_id = $2'))
  ) {
    return Promise.resolve({ rows: [{ '?column?': 1 }] })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages WHERE thread_id = $1') &&
    norm.includes('LIMIT 1') &&
    !norm.includes('recipient_id = $2')
  ) {
    return Promise.resolve({ rows: [{ '?column?': 1 }] })
  }

  if (norm.includes('DELETE FROM messages.user_archived_threads WHERE user_id = $1 AND thread_id = $2')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (
    norm.includes('FROM messages.user_archived_threads') &&
    norm.includes('user_id = $1') &&
    norm.includes('LIMIT 1') &&
    (norm.includes('thread_id = $2') || norm.includes('thread_id::text IN'))
  ) {
    return Promise.resolve({ rows: [] })
  }

  if (
    norm.includes('SELECT id, name, description, created_by, created_at, updated_at FROM messages.groups WHERE id = $1')
  ) {
    return Promise.resolve({
      rows: [
        {
          id: params[0],
          name: 'Study group',
          description: 'cs',
          created_by: userId,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('INSERT INTO messages.groups')) {
    return Promise.resolve({
      rows: [
        {
          id: groupId,
          name: params[0],
          description: params[1],
          created_by: params[2],
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (
    norm.includes('INSERT INTO messages.group_members') &&
    norm.includes('ON CONFLICT DO NOTHING')
  ) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.group_members')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.group_bans')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('DELETE FROM messages.group_bans WHERE')) {
    return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 })
  }

  if (norm.includes('SELECT 1 FROM messages.group_bans WHERE')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm === 'BEGIN' || norm === 'COMMIT' || norm === 'ROLLBACK') {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('UPDATE messages.groups SET archived = true')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('UPDATE messages.messages SET archived = true WHERE group_id')) {
    return Promise.resolve({ rows: [], rowCount: 0 })
  }

  if (
    norm.includes('DELETE FROM messages.group_members WHERE group_id = $1') &&
    !norm.includes('AND user_id')
  ) {
    return Promise.resolve({ rows: [], rowCount: 3 })
  }

  if (norm.includes('DELETE FROM messages.messages WHERE group_id = $1')) {
    return Promise.resolve({ rows: [], rowCount: 0 })
  }

  if (norm.includes('DELETE FROM messages.groups WHERE id = $1')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('WITH user_member AS')) {
    return Promise.resolve({
      rows: [{ user_role: 'member', elevated_count: 2 }],
    })
  }

  if (norm.includes('FROM messages.groups g') && norm.includes('INNER JOIN messages.group_members gm')) {
    return Promise.resolve({
      rows: [
        {
          id: groupId,
          name: 'Study group',
          description: 'cs',
          created_by: userId,
          created_at: new Date(),
          updated_at: new Date(),
          role: 'owner',
          joined_at: new Date(),
        },
      ],
    })
  }

  if (
    norm.includes('SELECT user_id, role, joined_at FROM messages.group_members') &&
    norm.includes('ORDER BY joined_at')
  ) {
    return Promise.resolve({
      rows: [
        { user_id: userId, role: 'owner', joined_at: new Date() },
        { user_id: recipientId, role: 'member', joined_at: new Date() },
      ],
    })
  }

  if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
    const uid = params[1] as string
    if (uid === userId) return Promise.resolve({ rows: [{ role: 'owner' }] })
    if (uid === recipientId) return Promise.resolve({ rows: [{ role: 'member' }] })
    return Promise.resolve({ rows: [{ role: 'member' }] })
  }

  if (norm.includes('DELETE FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (
    norm.includes('INSERT INTO messages.message_attachments') ||
    norm.includes('FROM messages.message_attachments')
  ) {
    if (norm.includes('INSERT')) {
      return Promise.resolve({
        rows: [
          {
            id: randomUUID(),
            message_id: params[0],
            file_url: params[1],
            file_type: params[7],
            created_at: new Date(),
          },
        ],
      })
    }
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          message_id: params[0],
          file_url: 'https://x.test/f.png',
          file_type: 'image',
          display_order: 0,
          created_at: new Date(),
        },
      ],
    })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages WHERE id = $1') &&
    norm.includes('sender_id = $2') &&
    norm.includes('recipient_id = $2') &&
    norm.includes('group_members')
  ) {
    const mid = params[0] as string
    if (mid === messageId) return Promise.resolve({ rows: [{ '?column?': 1 }] })
    return Promise.resolve({ rows: [] })
  }

  if (
    norm.includes('SELECT sender_id, recipient_id, group_id FROM messages.messages WHERE id = $1') &&
    norm.includes('sender_id = $2 OR recipient_id = $2')
  ) {
    return Promise.resolve({
      rows: [{ sender_id: recipientId, recipient_id: userId, group_id: null }],
    })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages m') &&
    norm.includes('m.deleted_at IS NULL') &&
    norm.includes('sender_id = $2 OR recipient_id')
  ) {
    return Promise.resolve({ rows: [{ '?column?': 1 }] })
  }

  if (
    norm.includes('SELECT 1 FROM messages.messages m') &&
    norm.includes('m.id = $1::uuid') &&
    !norm.includes('m.deleted_at IS NULL') &&
    norm.includes('group_members')
  ) {
    return Promise.resolve({ rows: [{ '?column?': 1 }] })
  }

  if (norm.includes('INSERT INTO messages.user_hidden_messages')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('DELETE FROM messages.user_hidden_messages')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('INNER JOIN messages.user_hidden_messages')) {
    return Promise.resolve({ rows: [] })
  }

  if (
    norm.includes('SELECT sender_id, deleted_at FROM messages.messages WHERE id = $1::uuid')
  ) {
    const mid = params[0] as string
    if (mid !== messageId) return Promise.resolve({ rows: [] })
    return Promise.resolve({ rows: [{ sender_id: userId, deleted_at: null }] })
  }

  if (
    norm.includes('SELECT sender_id, subject AS cur_subject, content AS cur_content, deleted_at') &&
    norm.includes('FROM messages.messages WHERE id = $1::uuid')
  ) {
    return Promise.resolve({
      rows: [{ sender_id: userId, cur_subject: 'OldSubj', cur_content: 'OldBody', deleted_at: null }],
    })
  }

  // Recall-only precheck (must not match edit/delete SELECT shapes)
  if (
    norm.includes('SELECT sender_id FROM messages.messages WHERE id = $1') &&
    !norm.includes('cur_subject') &&
    !norm.includes('deleted_at')
  ) {
    return Promise.resolve({ rows: [{ sender_id: userId }] })
  }

  if (
    norm.includes('UPDATE messages.messages') &&
    norm.includes('edited_at = CASE WHEN') &&
    norm.includes('WHERE id = $3::uuid AND deleted_at IS NULL')
  ) {
    return Promise.resolve({
      rows: [
        {
          id: params[2],
          sender_id: userId,
          recipient_id: recipientId,
          group_id: null,
          parent_message_id: null,
          thread_id: null,
          message_type: 'direct',
          subject: params[0],
          content: params[1],
          is_read: false,
          created_at: new Date(),
          updated_at: new Date(),
          edited_at: new Date(),
          deleted_at: null,
        },
      ],
    })
  }

  if (norm.includes('UPDATE messages.messages') && norm.includes('COALESCE($1, subject)')) {
    return Promise.resolve({
      rows: [
        {
          id: params[2],
          sender_id: userId,
          subject: 'Updated',
          content: 'Updated body',
          message_type: 'direct',
          is_read: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes("SET content = '[Message recalled]'")) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT id, is_read, updated_at FROM messages.messages WHERE id = $1')) {
    return Promise.resolve({ rows: [{ id: params[0], is_read: true, updated_at: new Date() }] })
  }

  if (
    norm.includes('FROM messages.user_archived_threads t') &&
    norm.includes('WHERE t.user_id = $1') &&
    norm.includes('ORDER BY t.archived_at')
  ) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('SELECT group_id FROM messages.group_members WHERE user_id = $1')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('COUNT(*)') && norm.includes('messages.messages') && norm.includes('UNION ALL')) {
    return Promise.resolve({ rows: [{ total: '1' }] })
  }

  if (norm.includes('COUNT(*)') && norm.includes('messages.messages')) {
    return Promise.resolve({ rows: [{ total: '0' }] })
  }

  if (norm.includes('UNION ALL') && norm.includes('FROM messages.messages') && !norm.includes('COUNT(*)')) {
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          sender_id: userId,
          recipient_id: recipientId,
          group_id: null,
          parent_message_id: null,
          thread_id: null,
          message_type: 'direct',
          subject: 'Inbox',
          content: 'Hi',
          is_read: false,
          created_at: new Date(),
          updated_at: new Date(),
          group_name: null,
          parent_message: null,
        },
      ],
    })
  }

  if (
    norm.includes('FROM messages.messages') &&
    norm.includes('recipient_id = $1') &&
    norm.includes('ORDER BY') &&
    !norm.includes('COUNT(*)')
  ) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('WHERE m.id = $1') && norm.includes('FROM messages.messages m')) {
    const mid = params[0] as string
    const uid = params[1] as string
    if (mid !== messageId) return Promise.resolve({ rows: [] })
    return Promise.resolve({
      rows: [
        {
          id: mid,
          sender_id: uid,
          recipient_id: recipientId,
          group_id: null,
          parent_message_id: null,
          thread_id: null,
          message_type: 'direct',
          subject: 'S',
          content: 'C',
          is_read: false,
          created_at: new Date(),
          updated_at: new Date(),
          group_name: null,
        },
      ],
    })
  }

  if (norm.includes('SELECT id, sender_id, recipient_id, group_id, subject, content, message_type, created_at')) {
    const mid = params[0] as string
    return Promise.resolve({
      rows: [
        {
          id: mid,
          sender_id: recipientId,
          recipient_id: userId,
          group_id: null,
          subject: 'Parent',
          content: 'Parent body',
          message_type: 'direct',
          created_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
    const uid = params[1] as string
    if (uid === userId) return Promise.resolve({ rows: [{ '?column?': 1 }] })
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO messages.messages')) {
    if (params.length === 7) {
      const row = {
        id: messageId,
        sender_id: params[0],
        recipient_id: params[1],
        group_id: params[2],
        parent_message_id: params[3],
        thread_id: null,
        message_type: params[4],
        subject: params[5],
        content: params[6],
        is_read: false,
        created_at: new Date(),
        updated_at: new Date(),
      }
      return Promise.resolve({ rows: [row] })
    }
    if (params.length === 6) {
      const row = {
        id: messageId,
        sender_id: params[0],
        recipient_id: params[1],
        group_id: null,
        parent_message_id: null,
        thread_id: params[2],
        message_type: params[3],
        subject: params[4],
        content: params[5],
        is_read: false,
        created_at: new Date(),
        updated_at: new Date(),
      }
      return Promise.resolve({ rows: [row] })
    }
    const row = {
      id: messageId,
      sender_id: params[0],
      recipient_id: params[1],
      group_id: params[2],
      parent_message_id: params[3],
      thread_id: params[4],
      message_type: params[5],
      subject: params[6],
      content: params[7],
      is_read: false,
      created_at: new Date(),
      updated_at: new Date(),
    }
    return Promise.resolve({ rows: [row] })
  }

  if (
    norm.includes('UPDATE messages.messages') &&
    norm.includes('deleted_at = now()') &&
    norm.includes('WHERE id = $1::uuid')
  ) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT post_id FROM forum.comments') && norm.includes('WHERE id')) {
    return Promise.resolve({ rows: [{ post_id: postId }] })
  }

  if (norm.includes('FROM forum.comments WHERE id = $1') && norm.includes('user_id') && norm.includes('post_id')) {
    return Promise.resolve({ rows: [{ user_id: userId, post_id: postId }] })
  }

  if (norm.includes('SELECT user_id FROM forum.comments WHERE id = $1')) {
    return Promise.resolve({ rows: [{ user_id: userId }] })
  }

  if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1')) {
    return Promise.resolve({ rows: [{ user_id: userId }] })
  }

  if (norm.includes('FROM forum.posts p WHERE p.id = $1::uuid')) {
    if (norm.includes('SELECT p.upvotes, p.downvotes')) {
      return Promise.resolve({
        rows: [{ upvotes: 3, downvotes: 1, user_vote: 'up' }],
      })
    }
    return Promise.resolve({
      rows: [
        {
          id: params[0],
          user_id: userId,
          title: 'Post',
          content: 'Body',
          flair: 'housing',
          upload_type: 'text',
          upvotes: 2,
          downvotes: 0,
          comment_count: 1,
          is_pinned: false,
          is_locked: false,
          created_at: new Date(),
          updated_at: new Date(),
          user_vote: null,
        },
      ],
    })
  }

  if (
    norm.includes('FROM forum.posts') &&
    norm.includes('WHERE id = $1') &&
    norm.includes('comment_count')
  ) {
    return Promise.resolve({
      rows: [
        {
          id: params[0],
          user_id: userId,
          title: 'Post',
          content: 'Body',
          flair: 'housing',
          upload_type: 'text',
          upvotes: 2,
          downvotes: 0,
          comment_count: 1,
          is_pinned: false,
          is_locked: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('UPDATE forum.posts') && norm.includes('COALESCE($1, title)')) {
    return Promise.resolve({
      rows: [
        {
          id: params[4],
          user_id: userId,
          title: 'Edited',
          content: 'E',
          flair: 'housing',
          upload_type: 'text',
          upvotes: 2,
          downvotes: 0,
          comment_count: 1,
          is_pinned: false,
          is_locked: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.startsWith('DELETE FROM forum.posts WHERE id = $1')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT vote_type FROM forum.post_votes WHERE post_id')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO forum.post_votes')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.startsWith('DELETE FROM forum.post_votes')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('UPDATE forum.posts SET') && norm.includes('upvotes = (SELECT COUNT(*)')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT upvotes, downvotes FROM forum.posts WHERE id = $1')) {
    return Promise.resolve({ rows: [{ upvotes: 3, downvotes: 1 }] })
  }

  if (norm.includes('FROM forum.comments WHERE post_id = $1')) {
    return Promise.resolve({
      rows: [
        {
          id: commentId,
          post_id: params[0],
          user_id: userId,
          parent_id: null,
          content: 'Nice',
          upvotes: 0,
          downvotes: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('INSERT INTO forum.comments')) {
    return Promise.resolve({
      rows: [
        {
          id: commentId,
          post_id: params[0],
          user_id: params[1],
          parent_id: params[2],
          content: params[3],
          upvotes: 0,
          downvotes: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('UPDATE forum.comments') && norm.includes('SET content = $1')) {
    return Promise.resolve({
      rows: [
        {
          id: params[1],
          post_id: postId,
          user_id: userId,
          parent_id: null,
          content: params[0],
          upvotes: 0,
          downvotes: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })
  }

  if (norm.startsWith('DELETE FROM forum.comments WHERE id = $1')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT vote_type FROM forum.comment_votes WHERE comment_id')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO forum.comment_votes')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.startsWith('DELETE FROM forum.comment_votes')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('UPDATE forum.comments SET') && norm.includes('upvotes = (SELECT COUNT(*)')) {
    return Promise.resolve({ rows: [], rowCount: 1 })
  }

  if (norm.includes('SELECT c.upvotes, c.downvotes') && norm.includes('FROM forum.comments c WHERE c.id')) {
    return Promise.resolve({ rows: [{ upvotes: 1, downvotes: 0, user_vote: 'up' }] })
  }

  if (norm.includes('SELECT upvotes, downvotes FROM forum.comments WHERE id = $1')) {
    return Promise.resolve({ rows: [{ upvotes: 1, downvotes: 0 }] })
  }

  if (norm.includes('INSERT INTO forum.comment_attachments')) {
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          comment_id: params[0],
          file_url: params[1],
          file_type: params[7],
          created_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('FROM forum.comment_attachments')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('FROM forum.posts') && norm.includes('COUNT(*)')) {
    return Promise.resolve({ rows: [{ total: '0' }] })
  }

  if (norm.includes('FROM forum.posts') && norm.includes('LIMIT')) {
    return Promise.resolve({ rows: [] })
  }

  if (norm.includes('INSERT INTO forum.post_attachments')) {
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          post_id: params[0],
          file_url: params[1],
          file_path: params[2],
          thumbnail_url: params[3],
          file_name: params[4],
          file_size: params[5],
          mime_type: params[6],
          file_type: params[7],
          width: params[8],
          height: params[9],
          duration: params[10],
          display_order: params[11],
          created_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('FROM forum.post_attachments') && norm.includes('WHERE post_id = $1')) {
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          post_id: params[0],
          file_url: 'https://x.test/post.png',
          file_path: null,
          thumbnail_url: null,
          file_name: null,
          file_size: null,
          mime_type: null,
          file_type: 'image',
          width: null,
          height: null,
          duration: null,
          display_order: 0,
          created_at: new Date(),
        },
      ],
    })
  }

  if (norm.includes('INSERT INTO forum.posts')) {
    const post = {
      id: randomUUID(),
      user_id: params[0],
      title: params[1],
      content: params[2],
      flair: params[3],
      upload_type: params[4],
      upvotes: 0,
      downvotes: 0,
      comment_count: 0,
      is_pinned: false,
      is_locked: false,
      created_at: new Date(),
      updated_at: new Date(),
    }
    return Promise.resolve({ rows: [post] })
  }

  return Promise.resolve({ rows: [] })
}

describe('createMessagingHttpApp (mocked pool + kafka)', () => {
  let app: Express

  beforeAll(async () => {
    const mod = await import('../src/http-app.js')
    app = mod.createMessagingHttpApp(null, 2)
  })

  beforeEach(() => {
    poolQuery.mockReset()
    poolQuery.mockImplementation(defaultPoolHandler)
    kafkaSend.mockClear()
  })

  it('GET /healthz returns 200', async () => {
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('GET /threads — missing x-user-id → 401', async () => {
    const res = await request(app).get('/threads')
    expect(res.status).toBe(401)
  })

  it('GET /mine — missing x-user-id → 401', async () => {
    const res = await request(app).get('/mine')
    expect(res.status).toBe(401)
  })

  it('GET /messages — missing x-user-id → 401', async () => {
    const res = await request(app).get('/messages')
    expect(res.status).toBe(401)
  })

  it('GET /messages — empty inbox', async () => {
    const res = await request(app).get('/messages').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
    expect(res.body.pagination.total).toBe(0)
  })

  it('GET /messages/users/search — q too short → 400', async () => {
    const res = await request(app).get('/messages/users/search?q=a').set('x-user-id', userId)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least 2/)
  })

  it('GET /messages/users/search — returns users from mirror', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('messaging-users-search')) {
        expect(params[0]).toBe(userId)
        return {
          rows: [
            {
              id: recipientId,
              username: 'peerhandle',
              display_name: 'Peer Display',
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get('/messages/users/search?q=peer').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.users)).toBe(true)
    expect(res.body.users).toHaveLength(1)
    expect(res.body.users[0].id).toBe(recipientId)
    expect(res.body.users[0].username).toBe('peerhandle')
  })

  it('POST /messages — both recipient_id and group_id → 400', async () => {
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({
        recipient_id: recipientId,
        group_id: groupId,
        message_type: 'direct',
        subject: 'Hi',
        content: 'Body',
      })
    expect(res.status).toBe(400)
  })

  it('POST /messages — neither recipient nor group → 400', async () => {
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({ message_type: 'direct', subject: 'Hi', content: 'Body' })
    expect(res.status).toBe(400)
  })

  it('POST /messages — missing message_type → 400', async () => {
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({ recipient_id: recipientId, subject: 'Hi', content: 'Body' })
    expect(res.status).toBe(400)
  })

  it('POST /messages — group message not a member → 403', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT 1 FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({
        group_id: groupId,
        message_type: 'group',
        subject: 'Hi',
        content: 'Body',
      })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not a member/)
  })

  it('POST /messages — direct message → 201', async () => {
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({
        recipient_id: recipientId,
        message_type: 'direct',
        subject: 'Hello',
        content: 'World',
      })
    expect(res.status).toBe(201)
    expect(res.body.subject).toBe('')
    expect(res.body.thread_id).toBe(stableHumanDmThreadId(userId, recipientId))
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('POST /messages — direct message without subject → 201 empty subject', async () => {
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({
        recipient_id: recipientId,
        message_type: 'direct',
        content: 'World',
      })
    expect(res.status).toBe(201)
    expect(res.body.subject).toBe('')
  })

  it('POST /messages/start — 400 missing fields', async () => {
    const res = await request(app).post('/messages/start').set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /messages/start — 403 renter mismatch', async () => {
    const res = await request(app)
      .post('/messages/start')
      .set('x-user-id', userId)
      .send({
        listing_id: randomUUID(),
        renter_id: otherUserId,
        initial_message: 'Hi',
      })
    expect(res.status).toBe(403)
  })

  it('POST /messages/start — 201 opens landlord thread', async () => {
    const listingUuid = randomUUID()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ landlord_id: recipientId, title: 'Nice unit' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    try {
      const res = await request(app)
        .post('/messages/start')
        .set('x-user-id', userId)
        .send({
          listing_id: listingUuid,
          renter_id: userId,
          initial_message: 'Tour request',
        })
      expect(res.status).toBe(201)
      expect(res.body.landlord_id).toBe(recipientId)
      expect(res.body.listing_id).toBe(listingUuid)
      expect(kafkaSend).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('DELETE /messages/:id — not found → 404', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT sender_id, deleted_at FROM messages.messages WHERE id = $1::uuid')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/${randomUUID()}`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('DELETE /messages/:id — success → 204', async () => {
    const res = await request(app).delete(`/messages/${messageId}`).set('x-user-id', userId)
    expect(res.status).toBe(204)
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('POST /messages/:id/hide-for-me — success → 204', async () => {
    const res = await request(app).post(`/messages/${messageId}/hide-for-me`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('DELETE /messages/:id/hide-for-me — success → 204', async () => {
    const res = await request(app).delete(`/messages/${messageId}/hide-for-me`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('GET /messages/thread/:tid/hidden-for-me — returns JSON', async () => {
    const tid = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT m.sender_id, m.recipient_id, m.group_id') && norm.includes('WHERE m.id::text = $1')) {
        return { rows: [] }
      }
      if (norm.includes('INNER JOIN messages.user_hidden_messages') && norm.includes('ORDER BY m.created_at ASC')) {
        expect(params[0]).toBe(tid)
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/thread/${tid}/hidden-for-me`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
  })

  it('POST /messages/:id/hide-for-me — 404 when message not accessible', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 FROM messages.messages m') &&
        norm.includes('m.id = $1::uuid') &&
        !norm.includes('m.deleted_at IS NULL')
      ) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/hide-for-me`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('GET /forum/posts — missing x-user-id → 401', async () => {
    const res = await request(app).get('/forum/posts')
    expect(res.status).toBe(401)
  })

  it('GET /forum/posts — empty list', async () => {
    const res = await request(app).get('/forum/posts').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.posts).toEqual([])
  })

  it('POST /forum/posts — missing fields → 400', async () => {
    const res = await request(app).post('/forum/posts').set('x-user-id', userId).send({ title: 'only' })
    expect(res.status).toBe(400)
  })

  it('POST /forum/posts — success → 201', async () => {
    const res = await request(app)
      .post('/forum/posts')
      .set('x-user-id', userId)
      .send({
        title: 'Title',
        content: 'Content',
        flair: 'housing',
      })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Title')
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('GET /messages/archived — returns list shape', async () => {
    const res = await request(app).get('/messages/archived').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.archived)).toBe(true)
  })

  it('GET /messages?type=direct — inbox with type filter', async () => {
    const res = await request(app).get('/messages?type=direct').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.pagination).toBeDefined()
  })

  it('GET /messages/:messageId — not found → 404', async () => {
    const res = await request(app).get(`/messages/${randomUUID()}`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('GET /messages/:messageId — success', async () => {
    const res = await request(app).get(`/messages/${messageId}`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(messageId)
  })

  it('POST /messages/:messageId/reply — missing content → 400', async () => {
    const res = await request(app).post(`/messages/${messageId}/reply`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /messages/:messageId/reply — success → 201', async () => {
    const res = await request(app)
      .post(`/messages/${messageId}/reply`)
      .set('x-user-id', userId)
      .send({ content: 'Reply body', message_type: 'direct', subject: 'Re: hi' })
    expect(res.status).toBe(201)
    expect(res.body.content).toBe('Reply body')
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('GET /messages/thread/:threadId — returns thread payload', async () => {
    const threadId = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT m.sender_id, m.recipient_id, m.group_id') && norm.includes('WHERE m.id::text = $1')) {
        return { rows: [] }
      }
      if (
        norm.includes('ORDER BY m.created_at ASC') &&
        (norm.includes('m.thread_id::text = $1') || norm.includes('uuid_generate_v5'))
      ) {
        expect(params[0]).toBe(threadId)
        return {
          rows: [
            {
              id: messageId,
              sender_id: userId,
              recipient_id: recipientId,
              group_id: null,
              parent_message_id: null,
              reply_to_message_id: null,
              thread_id: threadId,
              message_type: 'direct',
              subject: 'S',
              content: 'C',
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
              deleted_at: null,
              edited_at: null,
              recalled_at: null,
              sender_display_name: null,
              sender_username: null,
              recipient_display_name: null,
              recipient_username: null,
              reply_to_message: null,
              reactions: [],
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/thread/${threadId}`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.thread_id).toBe(threadId)
    expect(res.body.messages.length).toBe(1)
  })

  it('GET /messages/thread/:threadId — 404 when archived unless includeArchived=true', async () => {
    const tid = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT m.sender_id, m.recipient_id, m.group_id') && norm.includes('WHERE m.id::text = $1')) {
        return { rows: [] }
      }
      if (
        norm.includes('FROM messages.user_archived_threads') &&
        norm.includes('thread_id::text IN') &&
        norm.includes('LIMIT 1')
      ) {
        expect(params[0]).toBe(userId)
        expect(params[1]).toBe(tid)
        expect(params[2]).toBe(tid)
        return { rows: [{ '?column?': 1 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const hidden = await request(app).get(`/messages/thread/${tid}`).set('x-user-id', userId)
    expect(hidden.status).toBe(404)
    expect(hidden.body.error).toMatch(/includeArchived=true/)

    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT m.sender_id, m.recipient_id, m.group_id') && norm.includes('WHERE m.id::text = $1')) {
        return { rows: [] }
      }
      if (
        norm.includes('ORDER BY m.created_at ASC') &&
        (norm.includes('m.thread_id::text = $1') || norm.includes('uuid_generate_v5'))
      ) {
        return {
          rows: [
            {
              id: messageId,
              sender_id: userId,
              recipient_id: recipientId,
              group_id: null,
              parent_message_id: null,
              thread_id: tid,
              message_type: 'direct',
              subject: 'S',
              content: 'C',
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const shown = await request(app)
      .get(`/messages/thread/${tid}`)
      .query({ includeArchived: 'true' })
      .set('x-user-id', userId)
    expect(shown.status).toBe(200)
    expect(shown.body.messages.length).toBe(1)
  })

  it('GET /messages — default inbox SQL excludes user_archived_threads', async () => {
    const sqlCalls: string[] = []
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      sqlCalls.push(sql)
      return defaultPoolHandler(sql, params)
    })
    await request(app).get('/messages').set('x-user-id', userId)
    expect(sqlCalls.some((s) => s.includes('user_archived_threads'))).toBe(true)
  })

  it('GET /messages?includeArchived=true — omits archived exclusion clause', async () => {
    const sqlCalls: string[] = []
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      sqlCalls.push(sql)
      return defaultPoolHandler(sql, params)
    })
    await request(app).get('/messages?includeArchived=true').set('x-user-id', userId)
    const inboxSql = sqlCalls.find(
      (s) => s.includes('FROM messages.messages') && s.includes('recipient_id = $1'),
    )
    expect(inboxSql).toBeDefined()
    expect(inboxSql!.includes('user_archived_threads')).toBe(false)
  })

  it('GET /messages/archived — internal DB error → 500', async () => {
    poolQuery.mockRejectedValueOnce(new Error('db'))
    const res = await request(app).get('/messages/archived').set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('GET /messages — pagination params (page 2)', async () => {
    const res = await request(app).get('/messages?page=2&limit=5').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.pagination.page).toBe(2)
  })

  it('GET /messages — inbox with groups (UNION path)', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT group_id FROM messages.group_members WHERE user_id = $1')) {
        return { rows: [{ group_id: groupId }] }
      }
      if (norm.includes('COUNT(*)') && norm.includes('UNION ALL')) {
        return { rows: [{ total: '1' }] }
      }
      if (norm.includes('UNION ALL') && norm.includes('FROM messages.messages') && !norm.includes('COUNT')) {
        return {
          rows: [
            {
              id: randomUUID(),
              sender_id: userId,
              recipient_id: null,
              group_id: groupId,
              parent_message_id: null,
              thread_id: null,
              message_type: 'group',
              subject: 'G',
              content: 'gc',
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
              group_name: 'Team',
              parent_message: null,
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get('/messages').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.messages.length).toBe(1)
  })

  it('GET /messages — NaN page/limit fall back to defaults (parseInt guards)', async () => {
    const res = await request(app).get('/messages?page=not-a-number&limit=xyz').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.pagination.page).toBe(1)
    expect(res.body.pagination.limit).toBe(20)
  })

  it('GET /messages?includeArchived=false — still applies archived exclusion (not literal true)', async () => {
    const sqlCalls: string[] = []
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      sqlCalls.push(sql)
      return defaultPoolHandler(sql, params)
    })
    await request(app).get('/messages?includeArchived=false').set('x-user-id', userId)
    const inboxSql = sqlCalls.find(
      (s) => s.includes('FROM messages.messages') && s.includes('recipient_id = $1'),
    )
    expect(inboxSql).toBeDefined()
    expect(inboxSql!.includes('user_archived_threads')).toBe(true)
  })

  it('GET /messages/archived — 42P01 returns empty archived list', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('FROM messages.user_archived_threads t') &&
        norm.includes('WHERE t.user_id = $1') &&
        norm.includes('ORDER BY t.archived_at')
      ) {
        const err = Object.assign(new Error('missing rel'), { code: '42P01' })
        return Promise.reject(err)
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get('/messages/archived').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.archived).toEqual([])
  })

  it('GET /messages — no groups + type filter + includeArchived=true (else-branch with type)', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT group_id FROM messages.group_members WHERE user_id = $1')) {
        return { rows: [] }
      }
      if (norm.includes('COUNT(*)') && norm.includes('messages.messages') && !norm.includes('UNION ALL')) {
        return { rows: [{ total: '3' }] }
      }
      if (
        norm.includes('FROM messages.messages m') &&
        norm.includes('recipient_id = $1') &&
        norm.includes('ORDER BY m.created_at DESC')
      ) {
        expect(params).toContain('direct')
        return {
          rows: [
            {
              id: messageId,
              sender_id: recipientId,
              recipient_id: userId,
              group_id: null,
              parent_message_id: null,
              thread_id: null,
              message_type: 'direct',
              subject: 'D',
              content: 'Body',
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
              group_name: null,
              parent_message: null,
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .get('/messages?type=direct&includeArchived=true')
      .set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.messages[0].message_type).toBe('direct')
    expect(res.body.pagination.total).toBe(3)
  })

  it('GET /messages — UNION + type + includeArchived=true', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT group_id FROM messages.group_members WHERE user_id = $1')) {
        return { rows: [{ group_id: groupId }] }
      }
      if (norm.includes('COUNT(*)') && norm.includes('UNION ALL')) {
        return { rows: [{ total: '2' }] }
      }
      if (norm.includes('UNION ALL') && norm.includes('FROM messages.messages') && !norm.includes('COUNT')) {
        expect(params).toContain('direct')
        return {
          rows: [
            {
              id: randomUUID(),
              sender_id: userId,
              recipient_id: null,
              group_id: groupId,
              parent_message_id: null,
              thread_id: null,
              message_type: 'direct',
              subject: 'Union',
              content: 'U',
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
              group_name: 'G',
              parent_message: null,
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .get('/messages?type=direct&includeArchived=true')
      .set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.pagination.total).toBe(2)
  })

  it('POST /messages/thread/:threadId/delete — 404 when thread has no accessible messages', async () => {
    const tid = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 FROM messages.messages WHERE thread_id = $1') &&
        norm.includes('LIMIT 1') &&
        norm.includes('recipient_id = $2 OR sender_id = $2')
      ) {
        expect(params[0]).toBe(tid)
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/thread/${tid}/delete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(404)
  })

  it('POST /messages/thread/:threadId/delete — 501 when user_deleted_threads missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 FROM messages.messages WHERE thread_id = $1') &&
        norm.includes('LIMIT 1') &&
        norm.includes('recipient_id = $2 OR sender_id = $2')
      ) {
        return { rows: [{ '?column?': 1 }] }
      }
      if (norm.includes('INSERT INTO messages.user_deleted_threads')) {
        return Promise.reject(Object.assign(new Error('rel'), { code: '42P01' }))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/thread/${threadId}/delete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(501)
  })

  it('POST /messages/thread/:threadId/delete — 500 on unexpected insert error', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 FROM messages.messages WHERE thread_id = $1') &&
        norm.includes('LIMIT 1') &&
        norm.includes('recipient_id = $2 OR sender_id = $2')
      ) {
        return { rows: [{ '?column?': 1 }] }
      }
      if (norm.includes('INSERT INTO messages.user_deleted_threads')) {
        return Promise.reject(new Error('insert soft-delete failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/thread/${threadId}/delete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('GET /messages/thread/:threadId — 500 when archived-thread gate query fails (non-42P01)', async () => {
    const tid = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('FROM messages.user_archived_threads') &&
        norm.includes('thread_id::text IN') &&
        norm.includes('LIMIT 1')
      ) {
        return Promise.reject(new Error('archived gate boom'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/thread/${tid}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /messages/thread/:threadId/archive — 500 when BEGIN fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm === 'BEGIN') {
        return Promise.reject(new Error('begin failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/thread/${threadId}/archive`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/read — 500 when read receipt insert fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('INSERT INTO messages.message_reads')) {
        return Promise.reject(new Error('read insert fail'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/read`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/recall — 500 on unexpected update error', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes("SET content = '[Message recalled]'")) {
        return Promise.reject(new Error('recall boom'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('DELETE /messages/:messageId — 500 when soft-delete update fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('UPDATE messages.messages') && norm.includes('deleted_at = now()')) {
        return Promise.reject(new Error('delete failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/${messageId}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/attachments — 500 when insert fails after access check', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('INSERT INTO messages.message_attachments')) {
        return Promise.reject(new Error('attach insert'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${messageId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.test/a.png', file_type: 'image' })
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/reply — group parent uses null recipient_id branch', async () => {
    const parentMsg = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT id, sender_id, recipient_id, group_id, subject, content, message_type, created_at') &&
        norm.includes('FROM messages.messages WHERE id = $1')
      ) {
        if (params[0] === parentMsg) {
          return {
            rows: [
              {
                id: parentMsg,
                sender_id: otherUserId,
                recipient_id: null,
                group_id: groupId,
                subject: 'Group topic',
                content: 'G body',
                message_type: 'group',
                created_at: new Date(),
              },
            ],
          }
        }
      }
      if (norm.includes('INSERT INTO messages.messages') && params[3] === parentMsg) {
        expect(params[2]).toBe(groupId)
        expect(params[1]).toBe(null)
        return Promise.resolve({
          rows: [
            {
              id: randomUUID(),
              sender_id: params[0],
              recipient_id: params[1],
              group_id: params[2],
              parent_message_id: params[3],
              thread_id: threadId,
              message_type: params[4],
              subject: params[5],
              content: params[6],
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${parentMsg}/reply`)
      .set('x-user-id', userId)
      .send({ content: 'Reply in group' })
    expect(res.status).toBe(201)
    expect(res.body.group_id).toBe(groupId)
    expect(res.body.recipient_id).toBeNull()
  })

  it('POST /messages/:messageId/reply — P2P parent from self sets recipient_id null branch', async () => {
    const selfParent = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT id, sender_id, recipient_id, group_id, subject, content, message_type, created_at') &&
        norm.includes('FROM messages.messages WHERE id = $1') &&
        params[0] === selfParent
      ) {
        return {
          rows: [
            {
              id: selfParent,
              sender_id: userId,
              recipient_id: null,
              group_id: null,
              subject: 'Note to self',
              content: 'solo',
              message_type: 'direct',
              created_at: new Date(),
            },
          ],
        }
      }
      if (norm.includes('INSERT INTO messages.messages') && params[3] === selfParent) {
        expect(params[1]).toBe(null)
        return Promise.resolve({
          rows: [
            {
              id: randomUUID(),
              sender_id: params[0],
              recipient_id: params[1],
              group_id: params[2],
              parent_message_id: params[3],
              thread_id: null,
              message_type: params[4],
              subject: params[5],
              content: params[6],
              is_read: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${selfParent}/reply`)
      .set('x-user-id', userId)
      .send({ content: 'follow-up' })
    expect(res.status).toBe(201)
    expect(res.body.recipient_id).toBeNull()
  })

  it('POST /messages/:messageId/reply — long parent content uses ellipsis preview branch', async () => {
    const long = 'x'.repeat(140)
    const parentLong = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT id, sender_id, recipient_id, group_id, subject, content, message_type, created_at') &&
        norm.includes('FROM messages.messages WHERE id = $1') &&
        params[0] === parentLong
      ) {
        return {
          rows: [
            {
              id: parentLong,
              sender_id: recipientId,
              recipient_id: userId,
              group_id: null,
              subject: 'Subj',
              content: long,
              message_type: 'direct',
              created_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${parentLong}/reply`)
      .set('x-user-id', userId)
      .send({ content: 'short reply' })
    expect(res.status).toBe(201)
    expect(res.body.parent_message.content.endsWith('...')).toBe(true)
    expect(res.body.parent_message.content.length).toBeLessThanOrEqual(103)
  })

  it('POST /messages/thread/:threadId/archive — 500 when ROLLBACK after error throws', async () => {
    let phase = 0
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm === 'BEGIN') {
        phase = 1
        return Promise.resolve({ rows: [] })
      }
      if (
        phase === 1 &&
        norm.includes('SELECT 1 WHERE') &&
        norm.includes('FROM messages.messages m') &&
        norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
      ) {
        phase = 2
        return Promise.reject(new Error('access boom'))
      }
      if (norm === 'ROLLBACK') {
        return Promise.reject(new Error('rollback also failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/thread/${threadId}/archive`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('POST /messages/thread/:threadId/archive — 204 (idempotent)', async () => {
    const res = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
      .send({})
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    const again = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
      .send({})
    expect(again.status).toBe(204)
  })

  it('POST /messages/thread/:threadId/archive — 401 without user', async () => {
    const res = await request(app).post(`/messages/thread/${threadId}/archive`).send({})
    expect(res.status).toBe(401)
  })

  it('POST /messages/thread/:threadId/archive — 404 when thread does not exist', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 WHERE') &&
        norm.includes('FROM messages.messages m') &&
        norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
      ) {
        return { rows: [] }
      }
      if (norm.includes('SELECT 1 FROM messages.messages WHERE thread_id::text = $1 OR group_id::text = $1 LIMIT 1')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/thread/${randomUUID()}/archive`)
      .set('x-user-id', userId)
      .send({})
    expect(res.status).toBe(404)
  })

  it('POST /messages/thread/:threadId/archive — 403 when thread exists but user not participant', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 WHERE') &&
        norm.includes('FROM messages.messages m') &&
        norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
      ) {
        return { rows: [] }
      }
      if (norm.includes('SELECT 1 FROM messages.messages WHERE thread_id::text = $1 OR group_id::text = $1 LIMIT 1')) {
        return { rows: [{ '?column?': 1 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const tid = randomUUID()
    const res = await request(app).post(`/messages/thread/${tid}/archive`).set('x-user-id', userId).send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not a participant/)
  })

  it('POST /messages/thread/:threadId/delete — 201 soft-delete for me', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post(`/messages/thread/${threadId}/delete`)
      .set('x-user-id', userId)
      .send({})
    expect(res.status).toBe(201)
    expect(res.body.deleted_for_me).toBe(true)
  })

  it('POST /messages/groups — missing name → 400', async () => {
    const res = await request(app).post('/messages/groups').set('x-user-id', userId).send({ description: 'x' })
    expect(res.status).toBe(400)
  })

  it('POST /messages/groups — 201', async () => {
    const res = await request(app)
      .post('/messages/groups')
      .set('x-user-id', userId)
      .send({ name: 'Study group', description: 'cs' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(groupId)
  })

  it('POST /messages/groups/:groupId/members — 400 without user_id', async () => {
    const res = await request(app).post(`/messages/groups/${groupId}/members`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /messages/groups/:groupId/members — 201', async () => {
    const res = await request(app)
      .post(`/messages/groups/${groupId}/members`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(201)
  })

  it('POST /messages/groups/:groupId/members — 403 when banned', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('FROM messages.group_bans WHERE')) {
        return { rows: [{ '?column?': 1 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/groups/${groupId}/members`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(403)
  })

  it('POST /messages/groups/:groupId/members — 403 when not moderator', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        return { rows: [{ role: 'member' }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/groups/${groupId}/members`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(403)
  })

  it('POST /messages/groups/:groupId/kick — 400 without user_id', async () => {
    const res = await request(app).post(`/messages/groups/${groupId}/kick`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /messages/groups/:groupId/kick — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post(`/messages/groups/${groupId}/kick`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(200)
  })

  it('POST /messages/groups/:groupId/kick — 403 when non-owner tries to kick owner', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        const uid = params[1] as string
        if (uid === userId) return { rows: [{ role: 'admin' }] }
        if (uid === recipientId) return { rows: [{ role: 'owner' }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/groups/${groupId}/kick`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Only the owner can kick the owner/)
  })

  it('POST /messages/groups/:groupId/members — 403 when target user is banned', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT 1 FROM messages.group_bans WHERE')) {
        return { rows: [{ '?column?': 1 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/groups/${groupId}/members`)
      .set('x-user-id', userId)
      .send({ user_id: recipientId })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/banned/)
  })

  it('POST /messages/:messageId/attachments — 400 invalid file_type', async () => {
    const res = await request(app)
      .post(`/messages/${messageId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.com/a', file_type: 'exe' })
    expect(res.status).toBe(400)
  })

  it('POST /messages/:messageId/attachments — 201', async () => {
    const res = await request(app)
      .post(`/messages/${messageId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.com/a.png', file_type: 'image' })
    expect(res.status).toBe(201)
  })

  it('GET /messages/:messageId/attachments — 200', async () => {
    const res = await request(app).get(`/messages/${messageId}/attachments`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.attachments)).toBe(true)
  })

  it('PUT /messages/:messageId — 403 when not sender', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT sender_id, subject AS cur_subject, content AS cur_content, deleted_at') &&
        norm.includes('FROM messages.messages WHERE id = $1::uuid')
      ) {
        return { rows: [{ sender_id: recipientId, cur_subject: 's', cur_content: 'c', deleted_at: null }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .put(`/messages/${messageId}`)
      .set('x-user-id', userId)
      .send({ subject: 'x', content: 'y' })
    expect(res.status).toBe(403)
  })

  it('PUT /messages/:messageId — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .put(`/messages/${messageId}`)
      .set('x-user-id', userId)
      .send({ subject: 'Updated', content: 'Updated body' })
    expect(res.status).toBe(200)
    expect(res.body.subject).toBe('Updated')
  })

  it('POST /messages/:messageId/recall — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).post(`/messages/${messageId}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(res.body.recalled).toBe(true)
  })

  it('POST /messages/:messageId/read — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).post(`/messages/${messageId}/read`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('POST /messages/:messageId/read — 500 when Kafka publish fails after DB success', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    kafkaSend.mockRejectedValueOnce(new Error('read kafka down'))
    const res = await request(app).post(`/messages/${messageId}/read`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/read — uses is_read from row when truthy', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT id, is_read, updated_at FROM messages.messages WHERE id = $1')) {
        return { rows: [{ id: params[0], is_read: true, updated_at: new Date() }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/read`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(res.body.is_read).toBe(true)
  })

  it('POST /messages — group message → 201 when member', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post('/messages')
      .set('x-user-id', userId)
      .send({
        group_id: groupId,
        message_type: 'group',
        subject: 'G',
        content: 'All',
      })
    expect(res.status).toBe(201)
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('POST /messages/groups/:groupId/ban — 201', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post(`/messages/groups/${groupId}/ban`)
      .set('x-user-id', userId)
      .send({ user_id: otherUserId, reason: 'spam' })
    expect(res.status).toBe(201)
    expect(res.body.banned_user_id).toBe(otherUserId)
  })

  it('DELETE /messages/groups/:groupId/ban/:userId — 404 when not banned', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('DELETE FROM messages.group_bans WHERE')) {
        return { rows: [], rowCount: 0 }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .delete(`/messages/groups/${groupId}/ban/${otherUserId}`)
      .set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('DELETE /messages/groups/:groupId/ban/:userId — 204', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .delete(`/messages/groups/${groupId}/ban/${recipientId}`)
      .set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('GET /messages/groups — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).get('/messages/groups').set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.groups)).toBe(true)
    expect(res.body.groups.length).toBeGreaterThan(0)
  })

  it('GET /messages/groups/:groupId — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).get(`/messages/groups/${groupId}`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Study group')
    expect(Array.isArray(res.body.members)).toBe(true)
  })

  it('DELETE /messages/groups/:groupId/leave — 204', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).delete(`/messages/groups/${groupId}/leave`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('DELETE /messages/groups/:groupId?archive=true — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .delete(`/messages/groups/${groupId}?archive=true`)
      .set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)
  })

  it('DELETE /messages/groups/:groupId — 204 hard delete', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).delete(`/messages/groups/${groupId}`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('POST /messages/:messageId/recall — 403 when not sender', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT sender_id FROM messages.messages WHERE id = $1') && !norm.includes('recipient_id')) {
        return { rows: [{ sender_id: otherUserId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(403)
  })

  it('POST /messages/:messageId/recall — 404 when message missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT sender_id FROM messages.messages WHERE id = $1') && !norm.includes('recipient_id')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(404)
  })

  it('POST /messages/:messageId/recall — 501 when recalled_at column missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT sender_id FROM messages.messages WHERE id = $1') && !norm.includes('recipient_id')) {
        return { rows: [{ sender_id: userId }] }
      }
      if (norm.includes("SET content = '[Message recalled]'")) {
        const err = Object.assign(new Error('column'), { code: '42703' })
        return Promise.reject(err)
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${messageId}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(501)
  })

  it('POST /messages/thread/:threadId/archive — 500 on unexpected DB error', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm === 'BEGIN') return { rows: [] }
      if (norm === 'ROLLBACK') return { rows: [] }
      if (norm.startsWith('COMMIT')) return { rows: [] }
      if (
        norm.includes('SELECT 1 WHERE') &&
        norm.includes('FROM messages.messages m') &&
        norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
      ) {
        return { rows: [{ '?column?': 1 }] }
      }
      if (norm.includes('INSERT INTO messages.user_archived_threads')) {
        throw Object.assign(new Error('disk full'), { code: '58000' })
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
      .send({})
    expect(res.status).toBe(500)
    expect(String(res.body?.error || '')).toMatch(/archive/i)
  })

  it('POST /messages/thread/:threadId/archive — 204 on unique violation (23505)', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm === 'BEGIN') return { rows: [] }
      if (norm === 'ROLLBACK') return { rows: [] }
      if (norm.startsWith('COMMIT')) return { rows: [] }
      if (
        norm.includes('SELECT 1 WHERE') &&
        norm.includes('FROM messages.messages m') &&
        norm.includes('m.thread_id::text = $1 OR m.group_id::text = $1')
      ) {
        return { rows: [{ '?column?': 1 }] }
      }
      if (norm.includes('INSERT INTO messages.user_archived_threads')) {
        throw Object.assign(new Error('duplicate'), { code: '23505' })
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
      .send({})
    expect(res.status).toBe(204)
  })

  it('POST /forum/posts/:postId/attachments — 404 when post missing', async () => {
    const unknownPost = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1') && params[0] === unknownPost) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/forum/posts/${unknownPost}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.test/z.png', file_type: 'image' })
    expect(res.status).toBe(404)
  })

  it('POST /forum/posts/:postId/attachments — 403 when not author', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1')) {
        return { rows: [{ user_id: otherUserId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/forum/posts/${postId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.test/z.png', file_type: 'image' })
    expect(res.status).toBe(403)
  })

  it('GET /forum/posts/:postId/attachments — 500 on DB error', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('FROM forum.post_attachments') &&
        norm.includes('WHERE post_id = $1') &&
        !norm.includes('comment')
      ) {
        return Promise.reject(new Error('db read failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/forum/posts/${postId}/attachments`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /forum/posts/:postId/attachments — 201 and GET — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const post = await request(app)
      .post(`/forum/posts/${postId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.test/z.png', file_type: 'image' })
    expect(post.status).toBe(201)
    const list = await request(app).get(`/forum/posts/${postId}/attachments`).set('x-user-id', userId)
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body.attachments)).toBe(true)
  })

  it('GET /forum/posts/:postId — 200', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('FROM forum.posts p') &&
        norm.includes('WHERE p.id = $1::uuid') &&
        norm.includes('comment_count')
      ) {
        return {
          rows: [
            {
              id: params[0],
              user_id: userId,
              title: 'P',
              content: 'C',
              flair: 'housing',
              upload_type: 'text',
              upvotes: 1,
              downvotes: 0,
              comment_count: 0,
              is_pinned: false,
              is_locked: false,
              created_at: new Date(),
              updated_at: new Date(),
              user_vote: null,
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/forum/posts/${postId}`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('P')
  })

  it('PUT /forum/posts/:postId — 403 when not author', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1')) {
        return { rows: [{ user_id: otherUserId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .put(`/forum/posts/${postId}`)
      .set('x-user-id', userId)
      .send({ title: 'nope' })
    expect(res.status).toBe(403)
  })

  it('PUT /forum/posts/:postId — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .put(`/forum/posts/${postId}`)
      .set('x-user-id', userId)
      .send({ title: 'Edited', content: 'E' })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Edited')
  })

  it('DELETE /forum/posts/:postId — 204', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).delete(`/forum/posts/${postId}`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('POST /forum/posts/:postId/vote — 400', async () => {
    const res = await request(app).post(`/forum/posts/${postId}/vote`).set('x-user-id', userId).send({ vote: 'sideways' })
    expect(res.status).toBe(400)
  })

  it('POST /forum/posts/:postId/vote — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).post(`/forum/posts/${postId}/vote`).set('x-user-id', userId).send({ vote: 'up' })
    expect(res.status).toBe(200)
    expect(res.body.upvotes).toBe(3)
  })

  it('GET /forum/posts/:postId/comments — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).get(`/forum/posts/${postId}/comments`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.comments)).toBe(true)
    expect(res.body.comments.length).toBeGreaterThan(0)
  })

  it('POST /forum/posts/:postId/comments — 400 without content', async () => {
    const res = await request(app).post(`/forum/posts/${postId}/comments`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /forum/posts/:postId/comments — 201', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post(`/forum/posts/${postId}/comments`)
      .set('x-user-id', userId)
      .send({ content: 'First comment' })
    expect(res.status).toBe(201)
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('PUT /forum/comments/:commentId — 403', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.comments WHERE id = $1')) {
        return { rows: [{ user_id: otherUserId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .put(`/forum/comments/${commentId}`)
      .set('x-user-id', userId)
      .send({ content: 'hack' })
    expect(res.status).toBe(403)
  })

  it('PUT /forum/comments/:commentId — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .put(`/forum/comments/${commentId}`)
      .set('x-user-id', userId)
      .send({ content: 'Edited comment' })
    expect(res.status).toBe(200)
  })

  it('DELETE /forum/comments/:commentId — 204', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).delete(`/forum/comments/${commentId}`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('POST /forum/comments/:commentId/vote — 400', async () => {
    const res = await request(app).post(`/forum/comments/${commentId}/vote`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /forum/comments/:commentId/vote — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).post(`/forum/comments/${commentId}/vote`).set('x-user-id', userId).send({ vote: 'up' })
    expect(res.status).toBe(200)
  })

  it('POST /forum/comments/:commentId/attachments — 201', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app)
      .post(`/forum/comments/${commentId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.com/c.png', file_type: 'image' })
    expect(res.status).toBe(201)
  })

  it('GET /forum/comments/:commentId/attachments — 200', async () => {
    poolQuery.mockImplementation(defaultPoolHandler)
    const res = await request(app).get(`/forum/comments/${commentId}/attachments`).set('x-user-id', userId)
    expect(res.status).toBe(200)
  })

  it('POST /forum/posts — Kafka send fails → 500', async () => {
    kafkaSend.mockRejectedValueOnce(new Error('send fail'))
    const res = await request(app)
      .post('/forum/posts')
      .set('x-user-id', userId)
      .send({ title: 'K', content: 'C', flair: 'housing' })
    expect(res.status).toBe(500)
    kafkaSend.mockResolvedValue(undefined)
  })

  it('DELETE /messages/groups/:groupId/leave — 403 when not a member', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('WITH user_member AS')) {
        return { rows: [{ user_role: null, elevated_count: 0 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/groups/${groupId}/leave`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('DELETE /messages/groups/:groupId/leave — 400 when sole owner/admin', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('WITH user_member AS')) {
        return { rows: [{ user_role: 'owner', elevated_count: 1 }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/groups/${groupId}/leave`).set('x-user-id', userId)
    expect(res.status).toBe(400)
  })

  it('DELETE /messages/groups/:groupId — 403 when not a member', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/groups/${groupId}`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('DELETE /messages/groups/:groupId — 403 when member but not admin', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        return { rows: [{ role: 'member' }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/groups/${groupId}`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('DELETE /messages/groups/:groupId — 500 when transaction fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT role FROM messages.group_members WHERE group_id = $1 AND user_id = $2')) {
        return { rows: [{ role: 'owner' }] }
      }
      if (norm === 'BEGIN' || norm === 'ROLLBACK') return { rows: [] }
      if (norm.includes('DELETE FROM messages.group_members WHERE group_id = $1') && !norm.includes('AND user_id')) {
        return { rows: [], rowCount: 3 }
      }
      if (norm.includes('DELETE FROM messages.messages WHERE group_id = $1')) {
        return Promise.reject(new Error('tx fail'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/messages/groups/${groupId}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('PUT /messages/:messageId — 404 when message missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT sender_id, subject AS cur_subject, content AS cur_content, deleted_at') &&
        norm.includes('FROM messages.messages WHERE id = $1::uuid')
      ) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).put(`/messages/${messageId}`).set('x-user-id', userId).send({ content: 'x' })
    expect(res.status).toBe(404)
  })

  it('PUT /messages/:messageId — 403 when not sender', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT sender_id, subject AS cur_subject, content AS cur_content, deleted_at') &&
        norm.includes('FROM messages.messages WHERE id = $1::uuid')
      ) {
        return { rows: [{ sender_id: otherUserId, cur_subject: 's', cur_content: 'c', deleted_at: null }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).put(`/messages/${messageId}`).set('x-user-id', userId).send({ content: 'x' })
    expect(res.status).toBe(403)
  })

  it('PUT /messages/:messageId — 500 when update fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('UPDATE messages.messages') &&
        norm.includes('edited_at = CASE WHEN') &&
        norm.includes('WHERE id = $3::uuid AND deleted_at IS NULL')
      ) {
        return Promise.reject(new Error('update fail'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).put(`/messages/${messageId}`).set('x-user-id', userId).send({ content: 'x' })
    expect(res.status).toBe(500)
  })

  it('PUT /forum/posts/:postId — 404 when post missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1')) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).put(`/forum/posts/${postId}`).set('x-user-id', userId).send({ title: 'n' })
    expect(res.status).toBe(404)
  })

  it('PUT /forum/posts/:postId — 500 when update throws', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('UPDATE forum.posts') && norm.includes('COALESCE($1, title)')) {
        return Promise.reject(new Error('forum update'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).put(`/forum/posts/${postId}`).set('x-user-id', userId).send({ title: 'x' })
    expect(res.status).toBe(500)
  })

  it('DELETE /forum/posts/:postId — 500 when delete throws', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.startsWith('DELETE FROM forum.posts WHERE id = $1')) {
        return Promise.reject(new Error('delete post'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/forum/posts/${postId}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /forum/posts/:postId/vote — 500 when vote query fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('INSERT INTO forum.post_votes')) {
        return Promise.reject(new Error('vote fail'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/forum/posts/${postId}/vote`).set('x-user-id', userId).send({ vote: 'up' })
    expect(res.status).toBe(500)
  })

  it('GET /forum/posts — flair + pagination branches (non-null flair, page>1)', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('FROM forum.posts') && norm.includes('COUNT(*)')) {
        return { rows: [{ total: '37' }] }
      }
      if (norm.includes('FROM forum.posts') && norm.includes('LIMIT')) {
        expect(params[0]).toBe('housing')
        expect(params[1]).toBe(5)
        expect(params[2]).toBe(5)
        return {
          rows: [
            {
              id: postId,
              user_id: userId,
              title: 'Paged',
              content: 'C',
              flair: 'housing',
              upload_type: 'text',
              upvotes: 0,
              downvotes: 0,
              comment_count: 0,
              is_pinned: false,
              is_locked: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .get('/forum/posts')
      .set('x-user-id', userId)
      .query({ flair: 'housing', page: 2, limit: 5 })
    expect(res.status).toBe(200)
    expect(res.body.pagination.page).toBe(2)
    expect(res.body.pagination.total).toBe(37)
    expect(res.body.pagination.totalPages).toBe(8)
    expect(res.body.posts).toHaveLength(1)
  })

  it('POST /forum/posts — invalid upload_type falls back to text', async () => {
    const res = await request(app)
      .post('/forum/posts')
      .set('x-user-id', userId)
      .send({
        title: 'T',
        content: 'C',
        flair: 'housing',
        upload_type: 'not-a-valid-type',
      })
    expect(res.status).toBe(201)
    expect(res.body.upload_type).toBe('text')
  })

  it('PUT /forum/posts/:postId — invalid upload_type yields null COALESCE branch', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('UPDATE forum.posts') && norm.includes('COALESCE($1, title)')) {
        expect(params[3]).toBe(null)
        return {
          rows: [
            {
              id: postId,
              user_id: userId,
              title: 'T2',
              content: 'C2',
              flair: 'housing',
              upload_type: 'text',
              upvotes: 0,
              downvotes: 0,
              comment_count: 0,
              is_pinned: false,
              is_locked: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .put(`/forum/posts/${postId}`)
      .set('x-user-id', userId)
      .send({ title: 'T2', content: 'C2', upload_type: 'bogus-enum' })
    expect(res.status).toBe(200)
    expect(res.body.upload_type).toBe('text')
  })

  it('PUT /forum/posts/:postId — valid upload_type image', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('UPDATE forum.posts') && norm.includes('COALESCE($1, title)')) {
        expect(params[3]).toBe('image')
        return {
          rows: [
            {
              id: postId,
              user_id: userId,
              title: 'Pic',
              content: 'C',
              flair: 'housing',
              upload_type: 'image',
              upvotes: 0,
              downvotes: 0,
              comment_count: 0,
              is_pinned: false,
              is_locked: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .put(`/forum/posts/${postId}`)
      .set('x-user-id', userId)
      .send({ upload_type: 'image' })
    expect(res.status).toBe(200)
    expect(res.body.upload_type).toBe('image')
  })

  it('POST /forum/posts/:postId/vote — down vote branch', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('FROM forum.posts p WHERE p.id = $1::uuid') && norm.includes('SELECT p.upvotes')) {
        return { rows: [{ upvotes: 0, downvotes: 1, user_vote: 'down' }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/forum/posts/${postId}/vote`)
      .set('x-user-id', userId)
      .send({ vote: 'down' })
    expect(res.status).toBe(200)
    expect(res.body.vote).toBe('down')
    expect(res.body.downvotes).toBeGreaterThanOrEqual(1)
  })

  it('POST /forum/posts/:postId/attachments — 400 when file_type invalid', async () => {
    const res = await request(app)
      .post(`/forum/posts/${postId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.test/f', file_type: 'hologram' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/file_type must be one of/)
  })

  it('GET /forum/posts/:postId/comments — nested reply + orphan parent_id branch', async () => {
    const parentC = randomUUID()
    const replyC = randomUUID()
    const missingParent = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('FROM forum.comments WHERE post_id = $1')) {
        return {
          rows: [
            {
              id: parentC,
              post_id: params[0],
              user_id: userId,
              parent_id: null,
              content: 'root',
              upvotes: 0,
              downvotes: 0,
              created_at: new Date(),
              updated_at: new Date(),
            },
            {
              id: replyC,
              post_id: params[0],
              user_id: userId,
              parent_id: parentC,
              content: 'nested',
              upvotes: 0,
              downvotes: 0,
              created_at: new Date(),
              updated_at: new Date(),
            },
            {
              id: randomUUID(),
              post_id: params[0],
              user_id: userId,
              parent_id: missingParent,
              content: 'orphan-as-root',
              upvotes: 0,
              downvotes: 0,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/forum/posts/${postId}/comments`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.comments).toHaveLength(2)
    const root = res.body.comments.find((c: { id: string }) => c.id === parentC)
    expect(root?.replies?.some((r: { id: string }) => r.id === replyC)).toBe(true)
    expect(res.body.comments.some((c: { content: string }) => c.content === 'orphan-as-root')).toBe(true)
  })

  it('DELETE /forum/posts/:postId — 403 when not author', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT user_id FROM forum.posts WHERE id = $1') && !norm.includes('comment')) {
        return { rows: [{ user_id: otherUserId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).delete(`/forum/posts/${postId}`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('POST /forum/comments/:commentId/vote — down vote', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('SELECT c.upvotes, c.downvotes') && norm.includes('FROM forum.comments c WHERE c.id')) {
        return { rows: [{ upvotes: 0, downvotes: 1, user_vote: 'down' }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/forum/comments/${commentId}/vote`)
      .set('x-user-id', userId)
      .send({ vote: 'down' })
    expect(res.status).toBe(200)
    expect(res.body.vote).toBe('down')
  })

  it('POST /forum/posts/:postId/comments — 201 with parent_id (non-empty kafka branch)', async () => {
    const parent = randomUUID()
    const res = await request(app)
      .post(`/forum/posts/${postId}/comments`)
      .set('x-user-id', userId)
      .send({ content: 'child', parent_id: parent })
    expect(res.status).toBe(201)
    expect(res.body.parent_id).toBe(parent)
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('POST /messages/thread/:threadId/archive — 501 when user_archived_threads table missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('INSERT INTO messages.user_archived_threads')) {
        const err = Object.assign(new Error('relation missing'), { code: '42P01' })
        return Promise.reject(err)
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(res.status).toBe(501)
  })

  it('POST /messages/thread/:threadId/archive — 500 when COMMIT fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm === 'COMMIT') {
        return Promise.reject(new Error('commit failed'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('DELETE /messages/thread/:threadId/archive — 204 idempotent', async () => {
    const res = await request(app)
      .delete(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(res.status).toBe(204)
    const again = await request(app)
      .delete(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(again.status).toBe(204)
  })

  it('DELETE /messages/thread/:threadId/archive — 501 when table missing', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('DELETE FROM messages.user_archived_threads')) {
        const err = Object.assign(new Error('no relation'), { code: '42P01' })
        return Promise.reject(err)
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .delete(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(res.status).toBe(501)
  })

  it('DELETE /messages/thread/:threadId/archive — 500 on unexpected DB error', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('DELETE FROM messages.user_archived_threads')) {
        return Promise.reject(new Error('db down'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .delete(`/messages/thread/${threadId}/archive`)
      .set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /messages/groups — group insert race rejects with timeout message → 500', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('INSERT INTO messages.groups') && norm.includes('RETURNING')) {
        return Promise.reject(new Error('Database query timeout'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post('/messages/groups')
      .set('x-user-id', userId)
      .send({ name: `timeout-${randomUUID().slice(0, 8)}` })
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/attachments — 404 when message not accessible', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT sender_id, recipient_id, group_id FROM messages.messages WHERE id = $1') &&
        norm.includes('group_members')
      ) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${messageId}/attachments`)
      .set('x-user-id', userId)
      .send({ file_url: 'https://x.com/a.png', file_type: 'image' })
    expect(res.status).toBe(404)
  })

  it('GET /messages/:messageId/attachments — 404 when message not accessible', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('SELECT 1 FROM messages.messages WHERE id = $1') &&
        norm.includes('group_members')
      ) {
        return { rows: [] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/${messageId}/attachments`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('GET /messages/:messageId/attachments — 500 when listing attachments fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('FROM messages.message_attachments') && norm.includes('WHERE message_id = $1')) {
        return Promise.reject(new Error('attach list down'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/${messageId}/attachments`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('GET /messages/:messageId — 500 when detail query throws', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (norm.includes('WHERE m.id = $1') && norm.includes('FROM messages.messages m')) {
        return Promise.reject(new Error('slot failure'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).get(`/messages/${messageId}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })

  it('POST /messages/:messageId/recall — 403 when caller is not sender', async () => {
    const mid = randomUUID()
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.startsWith('SELECT sender_id FROM messages.messages WHERE id = $1') &&
        params[0] === mid
      ) {
        return { rows: [{ sender_id: recipientId }] }
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app).post(`/messages/${mid}/recall`).set('x-user-id', userId).send({})
    expect(res.status).toBe(403)
  })

  it('POST /messages/:messageId/reply — 500 when insert fails', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.replace(/\s+/g, ' ').trim()
      if (
        norm.includes('INSERT INTO messages.messages') &&
        norm.includes('parent_message_id') &&
        norm.includes('VALUES')
      ) {
        return Promise.reject(new Error('insert blow'))
      }
      return defaultPoolHandler(sql, params)
    })
    const res = await request(app)
      .post(`/messages/${messageId}/reply`)
      .set('x-user-id', userId)
      .send({ content: 'r' })
    expect(res.status).toBe(500)
  })
})
