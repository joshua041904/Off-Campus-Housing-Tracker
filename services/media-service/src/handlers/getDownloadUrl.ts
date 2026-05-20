import { createHmac, timingSafeEqual } from 'node:crypto'
import { getById } from '../db/mediaRepo.js'
import { createPresignedGetUrl, rewritePresignedPutUrlForBrowser } from '../storage/s3.js'

const PRESIGN_GET_EXPIRY_SEC = 60 * 60

export interface GetDownloadUrlResult {
  downloadUrl: string
  expiresAt: number
}

function mediaPublicSecret(): string {
  return String(process.env.MEDIA_PUBLIC_URL_SECRET || process.env.JWT_SECRET || 'och-media-public-dev').trim()
}

export function signInlineMediaDownload(mediaId: string, expSec: number): string {
  const msg = `${mediaId}:${expSec}`
  return createHmac('sha256', mediaPublicSecret()).update(msg).digest('hex')
}

export function verifyInlineMediaDownload(mediaId: string, expSec: number, sig: string): boolean {
  const exp = Number(expSec)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = signInlineMediaDownload(mediaId, exp)
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(String(sig).trim(), 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function getDownloadUrl(mediaId: string): Promise<GetDownloadUrlResult | null> {
  const row = await getById(mediaId)
  if (!row || row.status !== 'uploaded') return null
  const expiresAt = Math.floor(Date.now() / 1000) + PRESIGN_GET_EXPIRY_SEC

  if (row.object_key.startsWith('inline/') && row.inline_byte_len > 0) {
    const sig = signInlineMediaDownload(mediaId, expiresAt)
    const downloadUrl = `/api/media/public/${encodeURIComponent(mediaId)}?e=${expiresAt}&s=${encodeURIComponent(sig)}`
    return { downloadUrl, expiresAt }
  }

  const raw = await createPresignedGetUrl(row.object_key)
  const downloadUrl = rewritePresignedPutUrlForBrowser(raw)
  return { downloadUrl, expiresAt }
}
