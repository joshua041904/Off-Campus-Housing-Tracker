import { randomUUID } from 'crypto'

/** Object key format: user_id/YYYY/MM/uuid (per MEDIA_SERVICE_DESIGN). */
export function buildObjectKey(userId: string): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const u = randomUUID()
  return `${userId}/${y}/${m}/${u}`
}

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
])
const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

export function validateFileType(contentType: string): boolean {
  return ALLOWED_TYPES.has(contentType)
}

export function validateFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_SIZE_BYTES
}
