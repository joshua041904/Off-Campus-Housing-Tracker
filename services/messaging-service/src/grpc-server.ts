/**
 * gRPC server for MessagingService (proto/messaging.proto).
 * Direct Postgres with prepared statements; Redis rate limit; no Prisma.
 */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { resolveProtoPath } from '@common/utils/proto'
import { registerHealthService } from '@common/utils'
import { getPool, insertMessageAndOutbox, getConversationMessages, markAsRead, ensureConversation } from './db.js'
import { checkAndIncrement } from './rateLimit.js'

const PROTO_PATH = resolveProtoPath('messaging.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const messagingProto = grpc.loadPackageDefinition(packageDefinition) as any
const messagingService = messagingProto.messaging?.MessagingService?.service

if (!messagingService) {
  throw new Error('MessagingService not found in proto; check proto path and package name.')
}

async function sendMessage(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
  try {
    const { conversation_id: conversationId, sender_id: senderId, content, media_id: mediaId } = call.request
    if (!conversationId || !senderId || content === undefined) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'conversation_id, sender_id, content required' })
    }
    await checkAndIncrement(senderId)
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await ensureConversation(client, conversationId)
      const { messageId, sentAt } = await insertMessageAndOutbox(client, conversationId, senderId, content, mediaId || null)
      await client.query('COMMIT')
      return callback(null, { message_id: messageId, sent_at: sentAt })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      if ((e as Error).message?.includes('RATE_LIMIT')) {
        return callback({ code: grpc.status.RESOURCE_EXHAUSTED, message: (e as Error).message })
      }
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('[grpc] SendMessage error:', e)
    return callback({
      code: grpc.status.INTERNAL,
      message: (e as Error).message || 'SendMessage failed',
    })
  }
}

async function getConversation(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
  try {
    const { conversation_id: conversationId, limit = 50, before } = call.request
    if (!conversationId) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'conversation_id required' })
    }
    const lim = Math.min(Math.max(1, limit), 100)
    const { messages, hasMore } = await getConversationMessages(conversationId, lim, before || null)
    const list = messages.map((m) => ({
      message_id: m.id,
      sender_id: m.sender_id,
      content: m.body ?? '',
      sent_at: new Date(m.created_at).toISOString(),
      media_id: m.media_id ?? '',
    }))
    return callback(null, { messages: list, has_more: hasMore })
  } catch (e) {
    console.error('[grpc] GetConversation error:', e)
    return callback({
      code: grpc.status.INTERNAL,
      message: (e as Error).message || 'GetConversation failed',
    })
  }
}

async function markAsReadHandler(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
  try {
    const { conversation_id: conversationId, user_id: userId, message_id: messageId } = call.request
    if (!conversationId || !userId) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'conversation_id and user_id required' })
    }
    const success = await markAsRead(conversationId, userId, messageId || null)
    return callback(null, { success })
  } catch (e) {
    console.error('[grpc] MarkAsRead error:', e)
    return callback({
      code: grpc.status.INTERNAL,
      message: (e as Error).message || 'MarkAsRead failed',
    })
  }
}

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server()
  server.addService(messagingService, {
    SendMessage: sendMessage,
    GetConversation: getConversation,
    MarkAsRead: markAsReadHandler,
  })

  const healthCheck = async (): Promise<boolean> => {
    try {
      const pool = getPool()
      const r = await pool.query('SELECT 1')
      return r.rowCount !== undefined && r.rowCount >= 0
    } catch {
      return false
    }
  }
  registerHealthService(server, 'messaging.MessagingService', healthCheck)

  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      console.error('[grpc] bind failed:', err)
      process.exit(1)
    }
    console.log(`[grpc] MessagingService listening on 0.0.0.0:${boundPort}`)
  })

  return server
}
