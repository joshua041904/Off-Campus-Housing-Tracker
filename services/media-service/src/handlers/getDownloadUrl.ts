import { getById } from '../db/mediaRepo.js'
import { createPresignedGetUrl } from '../storage/s3.js'

const PRESIGN_GET_EXPIRY_SEC = 60 * 60

export interface GetDownloadUrlResult {
  downloadUrl: string
  expiresAt: number
}

export async function getDownloadUrl(mediaId: string): Promise<GetDownloadUrlResult | null> {
  const row = await getById(mediaId)
  if (!row || row.status !== 'uploaded') return null
  const downloadUrl = await createPresignedGetUrl(row.object_key)
  const expiresAt = Math.floor(Date.now() / 1000) + PRESIGN_GET_EXPIRY_SEC
  return { downloadUrl, expiresAt }
}
