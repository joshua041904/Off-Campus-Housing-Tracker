/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import os from 'os'
import { pool } from './lib/db.js'
import { makeRedis, cached, makePostKey, makePostsListKey, makeCommentsKey, makeMessagesKey, makeThreadKey } from './lib/cache.js'
import { kafka } from '@common/utils/kafka'
import { registerHealthService, createOchStrictMtlsServerCredentials } from '@common/utils'
import { resolveProtoPath } from '@common/utils/proto'
import { buildMetadata, sendMessagingEvent } from './kafkaMessagingEvents.js'
import { randomUUID } from 'node:crypto'

const PROTO_PATH = resolveProtoPath('messaging.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const messagingProto = grpc.loadPackageDefinition(packageDefinition) as any
const service = messagingProto.messaging?.v1?.MessagingService?.service
if (!service) {
  throw new Error('MessagingService not found (expected package messaging.v1)')
}

// Redis for caching
const redis = makeRedis()

// CPU cores for parallel processing
const CPU_CORES = os.cpus().length
console.log(`[messaging-grpc] Using ${CPU_CORES} CPU cores for parallel processing`)

// Kafka producer for real-time messaging (optional - fails gracefully if Kafka is unavailable)
let kafkaProducer: any = null
let kafkaConnectionFailed = false
async function getKafkaProducer() {
  if (kafkaConnectionFailed) {
    return null
  }
  if (!kafkaProducer) {
    try {
      kafkaProducer = kafka.producer()
      await Promise.race([
        kafkaProducer.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Kafka connection timeout')), 5000)
        ),
      ])
    } catch (err) {
      console.warn('[messaging] Kafka producer connection failed (non-fatal):', (err as Error)?.message || err)
      kafkaConnectionFailed = true
      kafkaProducer = null
      return null
    }
  }
  return kafkaProducer
}

// gRPC logging middleware
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now()
    console.log(`[gRPC] ${methodName} called`)
    try {
      await handler(call, callback)
      const duration = Date.now() - start
      console.log(`[gRPC] ${methodName} completed in ${duration}ms`)
    } catch (err: any) {
      const duration = Date.now() - start
      console.error(`[gRPC] ${methodName} failed after ${duration}ms:`, err)
      callback({
        code: grpc.status.INTERNAL,
        message: err.message || 'internal error',
      })
    }
  }
}

// Implement MessagingService (same handler implementations as social; RPC names match proto)
const handlers = {
  async ListPosts(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, flair } = call.request
    const cacheKey = makePostsListKey(page, limit, flair)
    const result = await cached(
      redis,
      cacheKey,
      60_000,
      async () => ({
        posts: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      })
    )
    callback(null, result)
  },

  async GetPost(call: any, callback: any) {
    const { post_id } = call.request
    const cacheKey = makePostKey(post_id)
    const result = await cached(
      redis,
      cacheKey,
      120_000,
      async () => ({
        post: {
          id: post_id,
          user_id: 'placeholder',
          title: 'Placeholder',
          content: 'Placeholder',
          flair: 'Discussion',
          upvotes: 0,
          downvotes: 0,
          comment_count: 0,
          is_pinned: false,
          is_locked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    )
    callback(null, result)
  },

  async CreatePost(call: any, callback: any) {
    const { user_id, title, content, flair } = call.request
    if (!title || !content || !flair) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'title, content, and flair required',
      })
    }
    callback(null, {
      post: {
        id: 'placeholder-post-id',
        user_id,
        title,
        content,
        flair,
        upvotes: 0,
        downvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_locked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async UpdatePost(call: any, callback: any) {
    const { post_id, user_id, title, content, flair } = call.request
    callback(null, {
      post: {
        id: post_id,
        user_id,
        title: title || 'Updated',
        content: content || 'Updated',
        flair: flair || 'Discussion',
        upvotes: 0,
        downvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_locked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async DeletePost(call: any, callback: any) {
    callback(null, { success: true })
  },

  async VotePost(call: any, callback: any) {
    const { post_id, user_id, vote } = call.request
    if (!post_id || !user_id || !vote || !['up', 'down'].includes(vote)) {
      callback({ code: 3, message: 'post_id, user_id, and vote (up/down) required' })
      return
    }
    try {
      await pool.query(
        `INSERT INTO forum.post_votes (post_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id) DO UPDATE SET vote_type = $3, created_at = now()`,
        [post_id, user_id, vote]
      )
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.posts WHERE id = $1',
        [post_id]
      )
      callback(null, {
        post_id,
        user_id,
        vote,
        upvotes: rows[0]?.upvotes ?? (vote === 'up' ? 1 : 0),
        downvotes: rows[0]?.downvotes ?? (vote === 'down' ? 1 : 0),
      })
    } catch (err: any) {
      console.error('[gRPC] VotePost error:', err)
      callback({ code: 13, message: err.message || 'Failed to vote on post' })
    }
  },

  async ListComments(call: any, callback: any) {
    const { post_id } = call.request
    const cacheKey = makeCommentsKey(post_id)
    const result = await cached(
      redis,
      cacheKey,
      30_000,
      async () => ({ post_id, comments: [] })
    )
    callback(null, result)
  },

  async CreateComment(call: any, callback: any) {
    const { post_id, user_id, content, parent_id } = call.request
    try {
      const insertQuery = `
        INSERT INTO forum.comments (post_id, user_id, parent_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, post_id, user_id, parent_id, content, upvotes, downvotes,
                  created_at, updated_at
      `
      const { rows } = await pool.query(insertQuery, [post_id, user_id, parent_id || null, content])
      const comment = rows[0]

      callback(null, {
        comment: {
          id: comment.id,
          post_id: comment.post_id,
          user_id: comment.user_id,
          parent_id: comment.parent_id || '',
          content: comment.content,
          upvotes: comment.upvotes,
          downvotes: comment.downvotes,
          created_at: comment.created_at.toISOString(),
          updated_at: comment.updated_at.toISOString(),
        },
      })
    } catch (error: any) {
      console.error('[gRPC] CreateComment error:', error)
      callback({
        code: 13,
        message: error.message || 'Failed to create comment',
      })
    }
  },

  async UpdateComment(call: any, callback: any) {
    const { comment_id, user_id, content } = call.request
    callback(null, {
      comment: {
        id: comment_id,
        user_id,
        content: content || 'Updated',
        upvotes: 0,
        downvotes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async DeleteComment(call: any, callback: any) {
    callback(null, { success: true })
  },

  async VoteComment(call: any, callback: any) {
    const { comment_id, user_id, vote } = call.request
    if (!comment_id || !user_id || !vote || !['up', 'down'].includes(vote)) {
      callback({ code: 3, message: 'comment_id, user_id, and vote (up/down) required' })
      return
    }
    try {
      await pool.query(
        `INSERT INTO forum.comment_votes (comment_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, user_id) DO UPDATE SET vote_type = $3, created_at = now()`,
        [comment_id, user_id, vote]
      )
      const { rows } = await pool.query(
        'SELECT upvotes, downvotes FROM forum.comments WHERE id = $1',
        [comment_id]
      )
      callback(null, {
        comment_id,
        user_id,
        vote,
        upvotes: rows[0]?.upvotes ?? (vote === 'up' ? 1 : 0),
        downvotes: rows[0]?.downvotes ?? (vote === 'down' ? 1 : 0),
      })
    } catch (err: any) {
      console.error('[gRPC] VoteComment error:', err)
      callback({ code: 13, message: err.message || 'Failed to vote on comment' })
    }
  },

  async ListMessages(call: any, callback: any) {
    const { user_id, page = 1, limit = 20, message_type } = call.request
    const cacheKey = makeMessagesKey(user_id, page, limit, message_type)
    try {
      const result = await Promise.race([
        cached(
          redis,
          cacheKey,
          30_000,
          async () => ({
            messages: [],
            pagination: { page, limit, total: 0, total_pages: 0 },
          })
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ListMessages cache timeout')), 5000)
        ),
      ]) as any
      callback(null, result)
    } catch (err: any) {
      console.warn('[messaging-grpc] ListMessages cache error, returning empty result:', err?.message)
      callback(null, {
        messages: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      })
    }
  },

  async GetMessage(call: any, callback: any) {
    const { message_id } = call.request
    callback(null, {
      message: {
        id: message_id,
        sender_id: 'placeholder',
        recipient_id: 'placeholder',
        parent_message_id: '',
        thread_id: '',
        message_type: 'General',
        subject: 'Placeholder',
        content: 'Placeholder',
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async SendMessage(call: any, callback: any) {
    const { sender_id, recipient_id, message_type, subject, content, parent_message_id } = call.request
    if (!recipient_id || !message_type || !subject || !content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'recipient_id, message_type, subject, and content required',
      })
    }

    const messageId = randomUUID()
    const createdAt = new Date().toISOString()
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await Promise.race([
          sendMessagingEvent(producer, recipient_id, {
            metadata: buildMetadata({
              event_type: 'MessageSent',
              aggregate_id: messageId,
              aggregate_type: 'message',
            }),
            message_id: messageId,
            sender_id,
            recipient_id,
            thread_id: parent_message_id ? 'thread-pending' : '',
            message_type,
            subject,
            content,
            created_at: createdAt,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Kafka send timeout')), 2000)
          ),
        ])
      }
    } catch (err) {
      console.warn('[messaging] Kafka publish failed (non-fatal):', err)
    }

    callback(null, {
      message: {
        id: messageId,
        sender_id,
        recipient_id,
        parent_message_id: parent_message_id || '',
        thread_id: parent_message_id ? 'placeholder-thread-id' : '',
        message_type,
        subject,
        content,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async ReplyMessage(call: any, callback: any) {
    const { message_id, sender_id, message_type, subject, content } = call.request
    if (!content) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'content required',
      })
    }

    const replyId = randomUUID()
    const replyCreated = new Date().toISOString()
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await sendMessagingEvent(producer, message_id, {
          metadata: buildMetadata({
            event_type: 'MessageReplied',
            aggregate_id: replyId,
            aggregate_type: 'message',
            causation_id: message_id,
          }),
          message_id: replyId,
          parent_message_id: message_id,
          sender_id,
          recipient_id: '',
          thread_id: '',
          content,
          created_at: replyCreated,
        })
      }
    } catch (err) {
      console.warn('[messaging] Kafka publish failed (non-fatal):', err)
    }

    callback(null, {
      message: {
        id: replyId,
        sender_id,
        recipient_id: 'placeholder',
        parent_message_id: message_id,
        thread_id: 'placeholder-thread-id',
        message_type: message_type || 'General',
        subject: subject || 'Re: ...',
        content,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })
  },

  async UpdateMessage(call: any, callback: any) {
    const { message_id, user_id, subject, content } = call.request
    const updatedAt = new Date().toISOString()
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await sendMessagingEvent(producer, message_id, {
          metadata: buildMetadata({
            event_type: 'MessageUpdated',
            aggregate_id: message_id,
            aggregate_type: 'message',
          }),
          message_id,
          subject: subject || 'Updated',
          content: content || 'Updated',
          updated_at: updatedAt,
        })
      }
    } catch (err) {
      console.warn('[messaging] Kafka MessageUpdated failed (non-fatal):', err)
    }
    callback(null, {
      message: {
        id: message_id,
        sender_id: user_id,
        subject: subject || 'Updated',
        content: content || 'Updated',
        updated_at: updatedAt,
      },
    })
  },

  async DeleteMessage(call: any, callback: any) {
    const { message_id } = call.request
    const deletedAt = new Date().toISOString()
    try {
      const producer = await getKafkaProducer()
      if (producer) {
        await sendMessagingEvent(producer, message_id, {
          metadata: buildMetadata({
            event_type: 'MessageDeleted',
            aggregate_id: message_id,
            aggregate_type: 'message',
          }),
          message_id,
          deleted_at: deletedAt,
        })
      }
    } catch (err) {
      console.warn('[messaging] Kafka MessageDeleted failed (non-fatal):', err)
    }
    callback(null, { success: true })
  },

  async GetThread(call: any, callback: any) {
    const { thread_id } = call.request
    const cacheKey = makeThreadKey(thread_id)
    const result = await cached(
      redis,
      cacheKey,
      60_000,
      async () => ({ thread_id, messages: [] })
    )
    callback(null, result)
  },

  async MarkMessageRead(call: any, callback: any) {
    const { message_id, user_id } = call.request
    const readAt = new Date().toISOString()
    try {
      const producer = await getKafkaProducer()
      if (producer && message_id && user_id) {
        await sendMessagingEvent(producer, message_id, {
          metadata: buildMetadata({
            event_type: 'MessageMarkedRead',
            aggregate_id: message_id,
            aggregate_type: 'message',
          }),
          message_id,
          user_id,
          read_at: readAt,
        })
      }
    } catch (err) {
      console.warn('[messaging] Kafka MessageMarkedRead failed (non-fatal):', err)
    }
    callback(null, { success: true })
  },

  async HealthCheck(call: any, callback: any) {
    try {
      await pool.query('SELECT 1')
      callback(null, { healthy: true, version: '0.1.0' })
    } catch (err) {
      callback(null, { healthy: false, version: '0.1.0' })
    }
  },
}

// Wrap all handlers with logging
const wrappedHandlers: any = {}
for (const [method, handler] of Object.entries(handlers)) {
  wrappedHandlers[method] = withLogging(handler, method)
}

export function startGrpcServer(port: number) {
  const server = new grpc.Server({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  })
  server.addService(service, wrappedHandlers)

  registerHealthService(server, 'messaging.v1.MessagingService', async () => {
    try {
      await pool.query('SELECT 1')
      return true
    } catch (err) {
      console.error('[messaging] Health check failed:', err)
      return false
    }
  })

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== 'false') {
    try {
      const { enableReflection } = require('@common/utils/grpc-reflection')
      enableReflection(server, [PROTO_PATH], ['messaging.v1.MessagingService'])
    } catch (err) {
      console.warn('[messaging gRPC] Failed to enable reflection:', err)
    }
  }

  let credentials: grpc.ServerCredentials
  try {
    credentials = createOchStrictMtlsServerCredentials('messaging gRPC')
    console.log('[messaging gRPC] strict mTLS (client cert required)')
  } catch (e) {
    console.error(e)
    process.exit(1)
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, actualPort) => {
    if (err) {
      console.error('[messaging] gRPC server bind failed:', err)
      return
    }
    server.start()
    console.log(`[messaging] gRPC server listening on port ${actualPort} (HTTP/2 only)`)
  })

  process.on('SIGTERM', async () => {
    console.log('[messaging] gRPC server shutting down...')
    server.forceShutdown()
    if (kafkaProducer) {
      await kafkaProducer.disconnect()
    }
    if (redis) {
      try {
        await redis.disconnect()
      } catch (err) {
        console.warn('[messaging] Redis disconnect error (non-fatal):', err)
      }
    }
  })
}
