/**
 * HTTP API for media (upload URL, complete, download URL, delete).
 * Used by `http-server.ts` and unit tests; does not listen or touch Kafka bootstrap.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { createHttpConcurrencyGuard, httpCounter, register, initOchOutboxSurfaceSupported, setOchOutboxUnpublishedCount, setOchOutboxOldestUnpublishedAgeSeconds } from '@common/utils'
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware, writeDebugTraceHeadersJson } from '@common/utils/otel'
import { checkConnection, getById, loadInlineBytes, pool, saveInlineBytes } from './db/mediaRepo.js'
import { completeUpload } from './handlers/completeUpload.js'
import { createUploadUrl } from './handlers/createUploadUrl.js'
import { getDownloadUrl, verifyInlineMediaDownload } from './handlers/getDownloadUrl.js'

async function refreshMediaOutboxScrapeGauges(): Promise<void> {
  try {
    const chk = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'media' AND table_name = 'outbox_events' LIMIT 1`,
    )
    if (!chk.rows.length) return
    const r = await pool.query<{ c: string; oldest: string | null }>(
      `SELECT COUNT(*)::text AS c,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text, '0') AS oldest
       FROM media.outbox_events WHERE published = false`,
    )
    const row = r.rows[0]
    const c = Math.max(0, Math.floor(Number(row?.c ?? 0)))
    const oldest = Math.max(0, Number(row?.oldest ?? 0))
    setOchOutboxUnpublishedCount(Number.isFinite(c) ? c : 0)
    setOchOutboxOldestUnpublishedAgeSeconds(Number.isFinite(oldest) ? oldest : 0)
  } catch {
    /* ignore */
  }
}

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
  initOchOutboxSurfaceSupported()
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

  /** Inline upload (no S3): raw body must be parsed before express.json(). */
  app.put(
    '/media/:mediaId/blob',
    requireUser,
    express.raw({ limit: '25mb', type: '*/*' }),
    async (req: AuthedRequest, res: Response) => {
      const { mediaId } = req.params
      try {
        const row = await getById(mediaId)
        if (!row) {
          res.status(404).json({ error: 'not found' })
          return
        }
        if (row.user_id !== req.userId) {
          res.status(403).json({ error: 'forbidden' })
          return
        }
        if (!row.object_key.startsWith('inline/')) {
          res.status(400).json({ error: 'not an inline upload' })
          return
        }
        if (row.status !== 'pending') {
          res.status(409).json({ error: 'upload already finalized' })
          return
        }
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? [])
        if (buf.length < 1) {
          res.status(400).json({ error: 'empty body' })
          return
        }
        const max = Math.max(row.size_bytes, 0) + 64 * 1024
        if (buf.length > max) {
          res.status(400).json({ error: 'body exceeds declared size_bytes' })
          return
        }
        await saveInlineBytes(mediaId, buf)
        res.status(204).end()
      } catch (e) {
        console.error('[media] inline blob put:', e)
        res.status(500).json({ error: 'failed to store bytes' })
      }
    },
  )

  /** Signed read for inline images (img src without auth). */
  app.get('/public/:mediaId', async (req: Request, res: Response) => {
    const { mediaId } = req.params
    const exp = Number(req.query.e)
    const sig = String(req.query.s || '')
    if (!verifyInlineMediaDownload(mediaId, exp, sig)) {
      res.status(403).json({ error: 'invalid or expired link' })
      return
    }
    try {
      const got = await loadInlineBytes(mediaId)
      if (!got) {
        res.status(404).end()
        return
      }
      res.setHeader('Content-Type', got.contentType)
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.send(got.bytes)
    } catch (e) {
      console.error('[media] public inline get:', e)
      res.status(500).end()
    }
  })

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
    await refreshMediaOutboxScrapeGauges()
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
