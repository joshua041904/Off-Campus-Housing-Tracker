/**
 * Entry: HTTP (4014) + gRPC (50064) for MessagingService.
 *
 * HTTP serves forum + messaging REST contracts:
 *   GET  /forum/posts
 *   POST /forum/posts
 *   GET  /messages
 *   POST /messages
 * ... (see routes/* for the full set)
 *
 * API gateway mounts under `/api/messaging`, so the effective external paths are:
 *   /api/messaging/forum/*
 *   /api/messaging/messages/*
 */
import express from 'express'
import os from 'os'
import { startGrpcServer } from './grpc-server.js'
import { messagingHttpConcurrencyGuard } from './http-concurrency-guard.js'
import { makeRedis } from './lib/cache.js'
import { requireUser } from './lib/auth.js'
import forumRouter from './routes/forum.js'
import messagesRouter from './routes/messages.js'

const httpPort = parseInt(process.env.HTTP_PORT || '4014', 10)
const grpcPort = parseInt(process.env.GRPC_PORT || process.env.MESSAGING_GRPC_PORT || '50064', 10)
const cpuCores = os.cpus().length

const redis = makeRedis()
const app = express()

app.use(express.json({ limit: '1mb' }))
app.use(messagingHttpConcurrencyGuard)

app.get(['/healthz', '/health'], (_req, res) => {
  res.status(200).json({ ok: true })
})

// Authenticated forum + messages routes.
// Messaging routes require x-user-id (provided by api-gateway after JWT verification).
app.use('/forum', requireUser, forumRouter(redis, cpuCores))
app.use('/messages', requireUser, messagesRouter(redis, cpuCores))

app.listen(httpPort, '0.0.0.0', () => {
  console.log(`[messaging] HTTP server listening on port ${httpPort}`)
})

startGrpcServer(grpcPort)
