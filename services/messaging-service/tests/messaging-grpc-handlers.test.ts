/**
 * Phase H: direct-invocation coverage for `grpc-server.ts` handlers (mock pool, cache, Kafka).
 */
import * as grpc from '@grpc/grpc-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}))

vi.mock('../src/lib/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
}))

vi.mock('../src/lib/cache.js', () => ({
  makeRedis: () => ({
    disconnect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
  cached: vi.fn(async (_r: unknown, _k: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  makePostKey: (id: string) => `post:${id}`,
  makePostsListKey: (page: number, limit: number, flair: string) => `posts:${page}:${limit}:${flair}`,
  makeCommentsKey: (id: string) => `comments:${id}`,
  makeMessagesKey: (userId: string, page: number, limit: number, messageType: string) =>
    `msgs:${userId}:${page}:${limit}:${messageType}`,
  makeThreadKey: (id: string) => `thread:${id}`,
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

const { messagingGrpcHandlers, messagingGrpcHealthProbe } = await import('../src/grpc-server.js')

type HandlerName = keyof typeof messagingGrpcHandlers

function invoke(name: HandlerName, request: Record<string, unknown>) {
  return new Promise<{ err: unknown; res: unknown }>((resolve, reject) => {
    const handler = messagingGrpcHandlers[name] as (
      call: { request: Record<string, unknown> },
      cb: (err: unknown, res?: unknown) => void
    ) => void | Promise<void>
    void Promise.resolve(handler({ request }, (err, res) => resolve({ err, res }))).catch(reject)
  })
}

describe('messagingGrpcHandlers', () => {
  beforeEach(() => {
    poolQuery.mockReset()
    poolQuery.mockResolvedValue({ rows: [{ upvotes: 2, downvotes: 1 }] })
    kafkaSend.mockClear()
    kafkaConnect.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ListPosts returns empty pagination', async () => {
    const { err, res } = await invoke('ListPosts', { user_id: 'u1', page: 1, limit: 10 })
    expect(err).toBeNull()
    expect((res as { posts: unknown[] }).posts).toEqual([])
  })

  it('GetPost returns placeholder post', async () => {
    const { err, res } = await invoke('GetPost', { post_id: 'p1' })
    expect(err).toBeNull()
    expect((res as { post: { id: string } }).post.id).toBe('p1')
  })

  it('CreatePost rejects missing fields', async () => {
    const { err, res } = await invoke('CreatePost', { user_id: 'u', title: '', content: 'c', flair: 'f' })
    expect(res).toBeUndefined()
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT)
  })

  it('CreatePost succeeds', async () => {
    const { err, res } = await invoke('CreatePost', {
      user_id: 'u',
      title: 't',
      content: 'c',
      flair: 'Discussion',
    })
    expect(err).toBeNull()
    expect((res as { post: { title: string } }).post.title).toBe('t')
  })

  it('UpdatePost merges defaults', async () => {
    const { err, res } = await invoke('UpdatePost', { post_id: 'p', user_id: 'u' })
    expect(err).toBeNull()
    expect((res as { post: { title: string } }).post.title).toBe('Updated')
  })

  it('DeletePost succeeds', async () => {
    const { err, res } = await invoke('DeletePost', { post_id: 'p' })
    expect(err).toBeNull()
    expect((res as { success: boolean }).success).toBe(true)
  })

  it('VotePost rejects invalid vote', async () => {
    const { err } = await invoke('VotePost', { post_id: 'p', user_id: 'u', vote: 'sideways' })
    expect((err as { code: number }).code).toBe(3)
  })

  it('VotePost succeeds with pool rows', async () => {
    const { err, res } = await invoke('VotePost', { post_id: 'p', user_id: 'u', vote: 'up' })
    expect(err).toBeNull()
    expect((res as { upvotes: number }).upvotes).toBe(2)
  })

  it('VotePost maps pool error to INTERNAL', async () => {
    poolQuery.mockRejectedValueOnce(new Error('db down'))
    const { err } = await invoke('VotePost', { post_id: 'p', user_id: 'u', vote: 'down' })
    expect((err as { code: number }).code).toBe(13)
  })

  it('ListComments returns empty comments', async () => {
    const { err, res } = await invoke('ListComments', { post_id: 'p' })
    expect(err).toBeNull()
    expect((res as { comments: unknown[] }).comments).toEqual([])
  })

  it('CreateComment persists and returns row', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'c1',
          post_id: 'p',
          user_id: 'u',
          parent_id: null,
          content: 'hello',
          upvotes: 0,
          downvotes: 0,
          created_at: new Date('2020-01-01'),
          updated_at: new Date('2020-01-02'),
        },
      ],
    })
    const { err, res } = await invoke('CreateComment', {
      post_id: 'p',
      user_id: 'u',
      content: 'hello',
      parent_id: '',
    })
    expect(err).toBeNull()
    expect((res as { comment: { id: string } }).comment.id).toBe('c1')
  })

  it('CreateComment maps DB error', async () => {
    poolQuery.mockRejectedValueOnce(new Error('constraint'))
    const { err } = await invoke('CreateComment', { post_id: 'p', user_id: 'u', content: 'x' })
    expect((err as { code: number }).code).toBe(13)
  })

  it('UpdateComment and DeleteComment succeed', async () => {
    const u = await invoke('UpdateComment', { comment_id: 'c', user_id: 'u', content: 'x' })
    expect(u.err).toBeNull()
    const d = await invoke('DeleteComment', { comment_id: 'c' })
    expect(d.err).toBeNull()
    expect((d.res as { success: boolean }).success).toBe(true)
  })

  it('VoteComment rejects invalid args', async () => {
    const { err } = await invoke('VoteComment', { comment_id: '', user_id: 'u', vote: 'up' })
    expect((err as { code: number }).code).toBe(3)
  })

  it('VoteComment succeeds', async () => {
    const { err, res } = await invoke('VoteComment', { comment_id: 'c', user_id: 'u', vote: 'up' })
    expect(err).toBeNull()
    expect((res as { upvotes: number }).upvotes).toBe(2)
  })

  it('ListMessages falls back on cache timeout', async () => {
    const { cached } = await import('../src/lib/cache.js')
    vi.mocked(cached).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('ListMessages cache timeout')), 5000)
        })
    )
    vi.useFakeTimers()
    const p = invoke('ListMessages', { user_id: 'u', page: 1, limit: 20 })
    await vi.advanceTimersByTimeAsync(5100)
    const { err, res } = await p
    expect(err).toBeNull()
    expect((res as { messages: unknown[] }).messages).toEqual([])
    vi.mocked(cached).mockImplementation(async (_r, _k, _ttl, fn) => fn())
  })

  it('GetMessage returns placeholder', async () => {
    const { err, res } = await invoke('GetMessage', { message_id: 'm1' })
    expect(err).toBeNull()
    expect((res as { message: { id: string } }).message.id).toBe('m1')
  })

  it('SendMessage rejects missing fields', async () => {
    const { err } = await invoke('SendMessage', { recipient_id: '', message_type: 't', subject: 's', content: 'c' })
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT)
  })

  it('SendMessage publishes and returns message', async () => {
    const { err, res } = await invoke('SendMessage', {
      sender_id: 'a',
      recipient_id: 'b',
      message_type: 'General',
      subject: 's',
      content: 'body',
      parent_message_id: '',
    })
    expect(err).toBeNull()
    expect((res as { message: { recipient_id: string } }).message.recipient_id).toBe('b')
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('ReplyMessage rejects empty content', async () => {
    const { err } = await invoke('ReplyMessage', { message_id: 'm', sender_id: 's', content: '' })
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT)
  })

  it('ReplyMessage publishes reply', async () => {
    const { err, res } = await invoke('ReplyMessage', {
      message_id: 'parent',
      sender_id: 's',
      message_type: 'General',
      subject: 'sub',
      content: 'reply body',
    })
    expect(err).toBeNull()
    expect((res as { message: { parent_message_id: string } }).message.parent_message_id).toBe('parent')
  })

  it('UpdateMessage and DeleteMessage publish events', async () => {
    const u = await invoke('UpdateMessage', { message_id: 'm', user_id: 'u', subject: 's', content: 'c' })
    expect(u.err).toBeNull()
    const d = await invoke('DeleteMessage', { message_id: 'm' })
    expect(d.err).toBeNull()
    expect(kafkaSend.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('GetThread returns empty messages', async () => {
    const { err, res } = await invoke('GetThread', { thread_id: 't1' })
    expect(err).toBeNull()
    expect((res as { thread_id: string }).thread_id).toBe('t1')
  })

  it('MarkMessageRead skips kafka when ids missing', async () => {
    kafkaSend.mockClear()
    const { err } = await invoke('MarkMessageRead', { message_id: '', user_id: '' })
    expect(err).toBeNull()
    expect(kafkaSend).not.toHaveBeenCalled()
  })

  it('MarkMessageRead publishes when ids present', async () => {
    const { err } = await invoke('MarkMessageRead', { message_id: 'm', user_id: 'u' })
    expect(err).toBeNull()
    expect(kafkaSend).toHaveBeenCalled()
  })

  it('HealthCheck reflects pool success and failure', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const ok = await invoke('HealthCheck', {})
    expect(ok.err).toBeNull()
    expect((ok.res as { healthy: boolean }).healthy).toBe(true)

    poolQuery.mockRejectedValueOnce(new Error('down'))
    const bad = await invoke('HealthCheck', {})
    expect(bad.err).toBeNull()
    expect((bad.res as { healthy: boolean }).healthy).toBe(false)
  })
})

describe('messagingGrpcHealthProbe', () => {
  beforeEach(() => {
    poolQuery.mockReset()
  })

  it('returns true when pool is healthy', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await expect(messagingGrpcHealthProbe()).resolves.toBe(true)
  })

  it('returns false when pool fails', async () => {
    poolQuery.mockRejectedValueOnce(new Error('econnrefused'))
    await expect(messagingGrpcHealthProbe()).resolves.toBe(false)
  })
})
