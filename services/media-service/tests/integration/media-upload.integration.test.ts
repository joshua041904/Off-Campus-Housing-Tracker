/**
 * Integration test B: create upload URL → (mock S3 PUT) → complete upload → assert DB status = uploaded.
 * Mocks S3 so objectExists returns true; no real MinIO required. Requires media DB (CI: same Postgres, port 5441).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createUploadUrl } from '../../src/handlers/createUploadUrl'
import { completeUpload } from '../../src/handlers/completeUpload'
import { getById } from '../../src/db/mediaRepo'

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

    const completed = await completeUpload(mediaId)
    expect(completed).toBe(true)

    const row = await getById(mediaId)
    expect(row).not.toBeNull()
    expect(row!.status).toBe('uploaded')
  })
})
