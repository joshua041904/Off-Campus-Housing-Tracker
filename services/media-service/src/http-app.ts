/**
 * HTTP API for media (upload URL, complete, download URL, delete).
 * Used by `http-server.ts` and unit tests; does not listen or touch Kafka bootstrap.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { createHttpConcurrencyGuard, httpCounter, register } from '@common/utils'
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware, writeDebugTraceHeadersJson } from '@common/utils/otel'
import { checkConnection, getById, pool } from './db/mediaRepo.js'
import { completeUpload } from './handlers/completeUpload.js'
import { createUploadUrl } from './handlers/createUploadUrl.js'
import { getDownloadUrl } from './handlers/getDownloadUrl.js'

type AuthedRequest = Request & { userId?: string }

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.get('x-user-id') || '').trim()
  if (!userId) {
    res.status(401).json({ error: 'missing x-user-id' })
    return
  }
  ;(req as AuthedRequest).userId = userId
  next()
}

export function createMediaHttpApp(): Express {
  const app = express()
  app.use((req, res, next) => {
    res.on('finish', () =>
      httpCounter.inc({
        service: 'media-service',
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
  app.use(express.json({ limit: '2mb' }))

  app.get(['/healthz', '/health', '/health/'], async (_req, res) => {
    try {
      const dbOk = await checkConnection()
      const body = {
        ok: dbOk,
        db: dbOk ? 'connected' : 'disconnected',
        service: 'media-service',
      }
      res.status(dbOk ? 200 : 503).json(body)
    } catch {
      res.status(503).json({ ok: false, db: 'error', service: 'media-service' })
    }
  })

  app.get(['/debug/headers', '/api/debug/headers'], (req, res) => {
    writeDebugTraceHeadersJson(req, res)
  })
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType)
    res.end(await register.metrics())
  })

  app.use(
    createHttpConcurrencyGuard({
      envVar: 'MEDIA_HTTP_MAX_CONCURRENT',
      defaultMax: 200,
      serviceLabel: 'media-service',
    }),
  )

  const media = express.Router()
  media.use(requireUser)

  media.post('/upload-url', async (req: AuthedRequest, res: Response) => {
    const { filename, content_type, size_bytes } = req.body as Record<string, unknown>
    if (filename == null || content_type == null || size_bytes == null) {
      res.status(400).json({ error: 'filename, content_type, and size_bytes are required' })
      return
    }
    try {
      const out = await createUploadUrl({
        userId: req.userId!,
        filename: String(filename),
        contentType: String(content_type),
        sizeBytes: Number(size_bytes),
      })
      res.status(201).json({
        media_id: out.mediaId,
        upload_url: out.uploadUrl,
        object_key: out.objectKey,
        expires_at: out.expiresAt,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'INVALID_FILE_TYPE') {
        res.status(400).json({ error: 'invalid file type' })
        return
      }
      if (msg === 'INVALID_FILE_SIZE') {
        res.status(400).json({ error: 'invalid file size' })
        return
      }
      console.error('[media] create upload url:', e)
      res.status(500).json({ error: 'failed to create upload url' })
    }
  })

  media.post('/:mediaId/complete', async (req: AuthedRequest, res: Response) => {
    const { mediaId } = req.params
    const row = await getById(mediaId)
    if (!row) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (row.user_id !== req.userId) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    try {
      const ok = await completeUpload(mediaId)
      if (!ok) {
        res.status(400).json({ error: 'object not found in storage or invalid state' })
        return
      }
      res.json({ success: true })
    } catch (e) {
      console.error('[media] complete upload:', e)
      res.status(500).json({ error: 'failed to complete upload' })
    }
  })

  media.get('/:mediaId/download-url', async (req: AuthedRequest, res: Response) => {
    const { mediaId } = req.params
    const row = await getById(mediaId)
    if (!row) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (row.user_id !== req.userId) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    try {
      const out = await getDownloadUrl(mediaId)
      if (!out) {
        res.status(404).json({ error: 'not available' })
        return
      }
      res.json({ download_url: out.downloadUrl, expires_at: out.expiresAt })
    } catch (e) {
      console.error('[media] download url:', e)
      res.status(502).json({ error: 'storage error' })
    }
  })

  media.delete('/:mediaId', async (req: AuthedRequest, res: Response) => {
    const { mediaId } = req.params
    const row = await getById(mediaId)
    if (!row) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (row.user_id !== req.userId) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    try {
      await pool.query('DELETE FROM media.media_files WHERE id = $1', [mediaId])
      res.status(204).end()
    } catch (e) {
      console.error('[media] delete:', e)
      res.status(500).json({ error: 'failed to delete' })
    }
  })

  app.use('/media', media)

  return app
}
