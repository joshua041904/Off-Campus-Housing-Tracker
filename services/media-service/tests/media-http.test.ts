import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Express } from 'express'

const userId = randomUUID()
const otherUserId = randomUUID()
const mediaId = randomUUID()

const {
  poolQuery,
  checkConnectionMock,
  getByIdMock,
  insertPendingMock,
  insertOutboxMock,
  saveInlineBytesMock,
  loadInlineBytesMock,
  createPresignedPut,
  createPresignedGet,
  objectExistsMock,
} = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  checkConnectionMock: vi.fn(),
  getByIdMock: vi.fn(),
  insertPendingMock: vi.fn(),
  insertOutboxMock: vi.fn(),
  saveInlineBytesMock: vi.fn(),
  loadInlineBytesMock: vi.fn(),
  createPresignedPut: vi.fn(),
  createPresignedGet: vi.fn(),
  objectExistsMock: vi.fn(),
}))

vi.mock('../src/db/mediaRepo.js', () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => poolQuery(...args),
      release: vi.fn(),
    }),
  },
  insertPending: (...args: unknown[]) => insertPendingMock(...args),
  getById: (id: string) => getByIdMock(id),
  saveInlineBytes: (...args: unknown[]) => saveInlineBytesMock(...args),
  loadInlineBytes: (...args: unknown[]) => loadInlineBytesMock(...args),
  setUploaded: vi.fn().mockResolvedValue(undefined),
  checkConnection: () => checkConnectionMock(),
}))

vi.mock('../src/storage/s3.js', () => ({
  createPresignedPutUrl: (key: string) => createPresignedPut(key),
  createPresignedGetUrl: (key: string) => createPresignedGet(key),
  objectExists: (key: string) => objectExistsMock(key),
  isS3CredentialsConfigured: () => true,
  rewritePresignedPutUrlForBrowser: (url: string) => url,
  s3Client: {},
  BUCKET: 'housing-media',
}))

vi.mock('../src/outbox/insertOutbox.js', () => ({
  insertOutbox: (...args: unknown[]) => insertOutboxMock(...args),
}))

function defaultPoolForComplete(sql: string): { rows: unknown[]; rowCount?: number } {
  const norm = sql.replace(/\s+/g, ' ').trim()
  if (norm === 'BEGIN' || norm === 'COMMIT' || norm === 'ROLLBACK') {
    return { rows: [] }
  }
  if (norm.includes("UPDATE media.media_files SET status = 'uploaded'")) {
    return { rows: [], rowCount: 1 }
  }
  if (norm.includes('INSERT INTO media.outbox_events')) {
    return { rows: [] }
  }
  if (norm.startsWith('DELETE FROM media.media_files WHERE id = $1')) {
    return { rows: [], rowCount: 1 }
  }
  if (norm.includes('UPDATE media.media_files SET inline_bytes')) {
    return { rows: [], rowCount: 1 }
  }
  if (norm.includes('SELECT content_type, inline_bytes FROM media.media_files')) {
    return {
      rows: [{ content_type: 'image/png', inline_bytes: Buffer.from([1, 2, 3]) }],
      rowCount: 1,
    }
  }
  return { rows: [] }
}

describe('createMediaHttpApp (mocked db + s3)', () => {
  let app: Express

  beforeAll(async () => {
    const mod = await import('../src/http-app.js')
    app = mod.createMediaHttpApp()
  })

  beforeEach(() => {
    poolQuery.mockReset()
    poolQuery.mockImplementation(async (sql: string) => defaultPoolForComplete(sql))
    checkConnectionMock.mockReset()
    checkConnectionMock.mockResolvedValue(true)
    getByIdMock.mockReset()
    insertPendingMock.mockReset()
    insertPendingMock.mockResolvedValue(undefined)
    insertOutboxMock.mockReset()
    insertOutboxMock.mockResolvedValue(undefined)
    createPresignedPut.mockReset()
    createPresignedPut.mockResolvedValue('https://s3.example/presigned-put')
    createPresignedGet.mockReset()
    createPresignedGet.mockResolvedValue('https://s3.example/presigned-get')
    objectExistsMock.mockReset()
    objectExistsMock.mockResolvedValue(true)
    saveInlineBytesMock.mockReset()
    saveInlineBytesMock.mockResolvedValue(undefined)
    loadInlineBytesMock.mockReset()
  })

  it('GET /debug/headers — invokes trace helper', async () => {
    const res = await request(app).get('/debug/headers')
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(500)
  })

  it('GET /healthz — 200 when DB ok', async () => {
    checkConnectionMock.mockResolvedValue(true)
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.service).toBe('media-service')
  })

  it('GET /healthz — 503 when DB down', async () => {
    checkConnectionMock.mockResolvedValue(false)
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
  })

  it('GET /healthz — 503 when check throws', async () => {
    checkConnectionMock.mockRejectedValue(new Error('db'))
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
  })

  it('POST /media/upload-url — 401 without x-user-id', async () => {
    const res = await request(app).post('/media/upload-url').send({
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 100,
    })
    expect(res.status).toBe(401)
  })

  it('POST /media/upload-url — 400 when fields missing', async () => {
    const res = await request(app).post('/media/upload-url').set('x-user-id', userId).send({ filename: 'x' })
    expect(res.status).toBe(400)
  })

  it('POST /media/upload-url — 400 invalid file type', async () => {
    const res = await request(app)
      .post('/media/upload-url')
      .set('x-user-id', userId)
      .send({ filename: 'x.bin', content_type: 'application/octet-stream', size_bytes: 10 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid file type/i)
  })

  it('POST /media/upload-url — 400 invalid file size', async () => {
    const res = await request(app)
      .post('/media/upload-url')
      .set('x-user-id', userId)
      .send({ filename: 'x.png', content_type: 'image/png', size_bytes: 0 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid file size/i)
  })

  it('POST /media/upload-url — 400 oversized', async () => {
    const res = await request(app)
      .post('/media/upload-url')
      .set('x-user-id', userId)
      .send({ filename: 'huge.mp4', content_type: 'video/mp4', size_bytes: 60 * 1024 * 1024 })
    expect(res.status).toBe(400)
  })

  it('PUT /media/:mediaId/blob — 204 stores inline bytes', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: `inline/${mediaId}`,
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 100,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app)
      .put(`/media/${mediaId}/blob`)
      .set('x-user-id', userId)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('hello'))
    expect(res.status).toBe(204)
    expect(saveInlineBytesMock).toHaveBeenCalled()
  })

  it('GET /public/:mediaId — 200 with valid signature', async () => {
    process.env.MEDIA_PUBLIC_URL_SECRET = 'unit-test-media-secret'
    const { signInlineMediaDownload } = await import('../src/handlers/getDownloadUrl.js')
    const exp = Math.floor(Date.now() / 1000) + 3600
    const sig = signInlineMediaDownload(mediaId, exp)
    loadInlineBytesMock.mockResolvedValueOnce({ contentType: 'image/png', bytes: Buffer.from([9, 9]) })
    const res = await request(app).get(`/public/${mediaId}`).query({ e: exp, s: sig })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
  })

  it('POST /media/upload-url — 201', async () => {
    const res = await request(app)
      .post('/media/upload-url')
      .set('x-user-id', userId)
      .send({ filename: 'a.png', content_type: 'image/png', size_bytes: 1024 })
    expect(res.status).toBe(201)
    expect(res.body.media_id).toBeTruthy()
    expect(res.body.upload_url).toContain('https://')
    expect(insertPendingMock).toHaveBeenCalled()
  })

  it('POST /media/upload-url — 201 inline fallback when presign fails', async () => {
    createPresignedPut.mockRejectedValueOnce(new Error('S3 unavailable'))
    const res = await request(app)
      .post('/media/upload-url')
      .set('x-user-id', userId)
      .send({ filename: 'a.png', content_type: 'image/png', size_bytes: 100 })
    expect(res.status).toBe(201)
    expect(String(res.body.upload_url || '')).toContain('/blob')
    expect(insertPendingMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('POST /media/:mediaId/complete — 404', async () => {
    getByIdMock.mockResolvedValue(null)
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(404)
  })

  it('POST /media/:mediaId/complete — 403 wrong owner', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: otherUserId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(403)
  })

  it('POST /media/:mediaId/complete — 400 when object missing in storage', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    objectExistsMock.mockResolvedValueOnce(false)
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(400)
  })

  it('POST /media/:mediaId/complete — 200 idempotent when already uploaded', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('POST /media/:mediaId/complete — 200 after pending + object exists', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    objectExistsMock.mockResolvedValue(true)
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('POST /media/:mediaId/complete — 200 when inline bytes present', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: `inline/${mediaId}`,
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 3,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 3,
    })
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(objectExistsMock).not.toHaveBeenCalled()
  })

  it('POST /media/:mediaId/complete — 500 when outbox insert fails', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    objectExistsMock.mockResolvedValue(true)
    insertOutboxMock.mockRejectedValueOnce(new Error('outbox full'))
    const res = await request(app).post(`/media/${mediaId}/complete`).set('x-user-id', userId).send({})
    expect(res.status).toBe(500)
  })

  it('GET /media/:mediaId/download-url — 404 not found', async () => {
    getByIdMock.mockResolvedValue(null)
    const res = await request(app).get(`/media/${mediaId}/download-url`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('GET /media/:mediaId/download-url — 403', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: otherUserId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).get(`/media/${mediaId}/download-url`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('GET /media/:mediaId/download-url — 404 when not uploaded yet', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).get(`/media/${mediaId}/download-url`).set('x-user-id', userId)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not available/i)
  })

  it('GET /media/:mediaId/download-url — 200', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).get(`/media/${mediaId}/download-url`).set('x-user-id', userId)
    expect(res.status).toBe(200)
    expect(res.body.download_url).toContain('https://')
  })

  it('GET /media/:mediaId/download-url — 502 when presign fails', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    createPresignedGet.mockRejectedValueOnce(new Error('S3 down'))
    const res = await request(app).get(`/media/${mediaId}/download-url`).set('x-user-id', userId)
    expect(res.status).toBe(502)
  })

  it('DELETE /media/:mediaId — 404', async () => {
    getByIdMock.mockResolvedValue(null)
    const res = await request(app).delete(`/media/${mediaId}`).set('x-user-id', userId)
    expect(res.status).toBe(404)
  })

  it('DELETE /media/:mediaId — 403', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: otherUserId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).delete(`/media/${mediaId}`).set('x-user-id', userId)
    expect(res.status).toBe(403)
  })

  it('DELETE /media/:mediaId — 204', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    const res = await request(app).delete(`/media/${mediaId}`).set('x-user-id', userId)
    expect(res.status).toBe(204)
  })

  it('DELETE /media/:mediaId — 500 when delete query fails', async () => {
    getByIdMock.mockResolvedValue({
      id: mediaId,
      user_id: userId,
      object_key: 'k',
      filename: 'a.png',
      content_type: 'image/png',
      size_bytes: 1,
      status: 'uploaded',
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    })
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.replace(/\s+/g, ' ').trim().startsWith('DELETE FROM media.media_files WHERE id = $1')) {
        return Promise.reject(new Error('db'))
      }
      return defaultPoolForComplete(sql)
    })
    const res = await request(app).delete(`/media/${mediaId}`).set('x-user-id', userId)
    expect(res.status).toBe(500)
  })
})
