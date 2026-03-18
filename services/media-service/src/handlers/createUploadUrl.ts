import { buildObjectKey, validateFileType, validateFileSize } from '../storage/objectKey.js'
import { createPresignedPutUrl } from '../storage/s3.js'
import { insertPending } from '../db/mediaRepo.js'
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
  const objectKey = buildObjectKey(input.userId)
  await insertPending(
    mediaId,
    input.userId,
    objectKey,
    input.filename,
    input.contentType,
    input.sizeBytes
  )
  const uploadUrl = await createPresignedPutUrl(objectKey)
  const expiresAt = Math.floor(Date.now() / 1000) + PRESIGN_EXPIRY_SEC
  return { mediaId, uploadUrl, objectKey, expiresAt }
}
