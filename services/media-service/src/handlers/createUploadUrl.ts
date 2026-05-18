import { buildObjectKey, validateFileType, validateFileSize } from '../storage/objectKey.js'
import {
  createPresignedPutUrl,
  isS3CredentialsConfigured,
  rewritePresignedPutUrlForBrowser,
} from '../storage/s3.js'
import { insertPending, pool } from '../db/mediaRepo.js'
import { randomUUID } from 'crypto'

const PRESIGN_EXPIRY_SEC = 5 * 60

export interface CreateUploadUrlInput {
  userId: string
  filename: string
  contentType: string
  sizeBytes: number
}

export interface CreateUploadUrlResult {
  mediaId: string
  uploadUrl: string
  objectKey: string
  expiresAt: number
}

export async function createUploadUrl(input: CreateUploadUrlInput): Promise<CreateUploadUrlResult> {
  if (!validateFileType(input.contentType)) {
    throw new Error('INVALID_FILE_TYPE')
  }
  if (!validateFileSize(input.sizeBytes)) {
    throw new Error('INVALID_FILE_SIZE')
  }
  const mediaId = randomUUID()
  let objectKey = isS3CredentialsConfigured() ? buildObjectKey(input.userId) : `inline/${mediaId}`
  await insertPending(
    mediaId,
    input.userId,
    objectKey,
    input.filename,
    input.contentType,
    input.sizeBytes,
  )

  let uploadUrl: string
  if (objectKey.startsWith('inline/')) {
    uploadUrl = `/api/media/media/${mediaId}/blob`
  } else {
    try {
      const raw = await createPresignedPutUrl(objectKey)
      uploadUrl = rewritePresignedPutUrlForBrowser(raw)
    } catch (e) {
      console.warn('[media] S3 presign failed; using inline DB storage', e)
      await pool.query('DELETE FROM media.media_files WHERE id = $1', [mediaId])
      objectKey = `inline/${mediaId}`
      await insertPending(
        mediaId,
        input.userId,
        objectKey,
        input.filename,
        input.contentType,
        input.sizeBytes,
      )
      uploadUrl = `/api/media/media/${mediaId}/blob`
    }
  }

  const expiresAt = Math.floor(Date.now() / 1000) + PRESIGN_EXPIRY_SEC
  return { mediaId, uploadUrl, objectKey, expiresAt }
}
