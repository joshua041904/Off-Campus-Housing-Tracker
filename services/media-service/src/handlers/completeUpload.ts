import { objectExists } from '../storage/s3.js'
import { getById, setUploaded, pool } from '../db/mediaRepo.js'
import { insertOutbox } from '../outbox/insertOutbox.js'

/** MediaUploadedV1 stub: minimal proto-like encoding. Replace with real proto serialization. */
function encodeMediaUploadedV1(mediaId: string, userId: string, contentType: string, uploadedAt: string): Buffer {
  const payload = JSON.stringify({ media_id: mediaId, user_id: userId, content_type: contentType, uploaded_at: uploadedAt })
  return Buffer.from(payload, 'utf-8')
}

export async function completeUpload(mediaId: string): Promise<boolean> {
  const row = await getById(mediaId)
  if (!row) return false
  if (row.status === 'uploaded') return true
  const exists = await objectExists(row.object_key)
  if (!exists) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setUploaded(mediaId, client)
    const uploadedAt = new Date().toISOString()
    await insertOutbox(mediaId, 'MediaUploadedV1', 1, encodeMediaUploadedV1(mediaId, row.user_id, row.content_type, uploadedAt), client)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return true
}
