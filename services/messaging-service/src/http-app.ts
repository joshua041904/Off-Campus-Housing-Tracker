/**
 * HTTP app factory for messaging-service (forum + messages REST).
 * Used by `server.ts` and unit tests; does not listen or touch Kafka bootstrap.
 */
import express, { type Express } from 'express'
import type Redis from 'ioredis'
import { createHttpConcurrencyGuard, httpCounter, register, initOchOutboxSurfaceUnsupported } from '@common/utils'
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware } from '@common/utils/otel'
import { requireUser, type AuthedRequest } from './lib/auth.js'
import { getChatThreadsList, getMessagingUnreadCountHandler } from './routes/chat-threads.js'
import forumRouter from './routes/forum.js'
import messagesRouter from './routes/messages.js'

export function createMessagingHttpApp(redis: Redis | null, cpuCores = 1): Express {
  const app = express()
  initOchOutboxSurfaceUnsupported()
  app.use((req, res, next) => {
    res.on('finish', () =>
      httpCounter.inc({
        service: 'messaging-service',
        route: req.path,
        method: req.method,
        code: res.statusCode,
        proto: inferNetProtoForSpan(req),
      }),
    )
    next()
  })

  app.use(tracingMiddleware)
  mountDebugTraceHeaders(app)
  app.use(express.json({ limit: '1mb' }))

  app.get(['/healthz', '/health'], (_req, res) => {
    res.status(200).json({ ok: true })
  })
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType)
    res.end(await register.metrics())
  })

  app.use(
    createHttpConcurrencyGuard({
      envVar: 'MESSAGING_HTTP_MAX_CONCURRENT',
      /** Single-pod load tests: allow more in-flight before 503; still bounded (backpressure). */
      defaultMax: 200,
      serviceLabel: 'messaging-service',
    }),
  )

  /** Inbox thread list (gateway strips /api/messaging → /threads or /mine). */
  app.get('/threads', requireUser, (req, res) => void getChatThreadsList(req as AuthedRequest, res))
  app.get('/mine', requireUser, (req, res) => void getChatThreadsList(req as AuthedRequest, res))

  /** Must register before `/messages` router so this path is not swallowed by the messages app. */
  app.get('/messages/unread-count', requireUser, (req, res) =>
    void getMessagingUnreadCountHandler(req as AuthedRequest, res),
  )

  app.use('/forum', requireUser, forumRouter(redis, cpuCores))
  app.use('/messages', requireUser, messagesRouter(redis, cpuCores))

  return app
}
