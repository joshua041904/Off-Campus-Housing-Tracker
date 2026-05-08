/**
 * HTTP app factory for messaging-service (forum + messages REST).
 * Used by `server.ts` and unit tests; does not listen or touch Kafka bootstrap.
 */
import express, { type Express } from 'express'
import type Redis from 'ioredis'
import { createHttpConcurrencyGuard, httpCounter, register } from '@common/utils'
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware } from '@common/utils/otel'
import { requireUser } from './lib/auth.js'
import forumRouter from './routes/forum.js'
import messagesRouter from './routes/messages.js'

export function createMessagingHttpApp(redis: Redis | null, cpuCores = 1): Express {
  const app = express()
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

  app.use('/forum', requireUser, forumRouter(redis, cpuCores))
  app.use('/messages', requireUser, messagesRouter(redis, cpuCores))

  return app
}
