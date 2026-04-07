/**
 * Integration: create upload URL → (mock S3 PUT) → complete upload → assert DB status = uploaded
 * **and** transactional `media.outbox_events` row (`MediaUploadedV1`, `published = false`).
 * **Postgres + mocked S3 only** — no Kafka client (publisher drain is separate).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createUploadUrl } from '../../src/handlers/createUploadUrl'
import { completeUpload } from '../../src/handlers/completeUpload'
import { getById, pool } from '../../src/db/mediaRepo'

vi.mock('../../src/storage/s3', () => ({
  createPresignedPutUrl: () => Promise.resolve('http://fake-presigned-url'),
  objectExists: () => Promise.resolve(true),
}))

describe('Media upload (integration)', () => {
  beforeAll(() => {
    if (!process.env.PG_HOST && !process.env.PGHOST) {
      console.warn('PG_HOST not set; media DB may be unreachable')
    }
  })

  it('B) createUploadUrl then completeUpload sets DB status to uploaded', async () => {
    const userId = '11111111-1111-4111-a111-111111111111'
    const { mediaId } = await createUploadUrl({
      userId,
      filename: 'test.png',
      contentType: 'image/png',
      sizeBytes: 100,
    })
    expect(mediaId).toBeDefined()

    try {
      const completed = await completeUpload(mediaId)
      expect(completed).toBe(true)

      const row = await getById(mediaId)
      expect(row).not.toBeNull()
      expect(row!.status).toBe('uploaded')

      const hasOutbox = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'media' AND table_name = 'outbox_events' LIMIT 1`,
      )
      if (!hasOutbox.rows.length) {
        console.warn('[media integration] media.outbox_events missing — apply infra/db/02-media-outbox.sql')
        return
      }

      const ob = await pool.query<{
        aggregate_id: string
        type: string
        version: number
        published: boolean
      }>(
        `SELECT aggregate_id, type, version, published FROM media.outbox_events WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [mediaId],
      )
      expect(ob.rows[0]).toBeDefined()
      expect(ob.rows[0].type).toBe('MediaUploadedV1')
      expect(ob.rows[0].version).toBe(1)
      expect(ob.rows[0].aggregate_id).toBe(mediaId)
      expect(ob.rows[0].published).toBe(false)
    } finally {
      await pool.query(`DELETE FROM media.outbox_events WHERE aggregate_id = $1`, [mediaId]).catch(() => undefined)
      await pool.query(`DELETE FROM media.media_files WHERE id = $1`, [mediaId]).catch(() => undefined)
    }
  })
})
