import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const endpoint = process.env.S3_ENDPOINT || 'http://minio:9000'
const bucket = process.env.S3_BUCKET || 'housing-media'
const region = process.env.S3_REGION || 'us-east-1'
const useSSL = process.env.S3_USE_SSL === 'true'

export const s3Client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  ...(endpoint.startsWith('https') || useSSL
    ? {}
    : { tls: false }),
})

export const BUCKET = bucket

/** MinIO/S3 needs access keys for presigned URLs; without them, media-service uses DB inline_bytes instead. */
export function isS3CredentialsConfigured(): boolean {
  const ak = String(process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || '').trim()
  const sk = String(process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || '').trim()
  return ak.length > 0 && sk.length > 0
}

/** Rewrite presigned S3/MinIO URL host for the browser (in-cluster endpoint is not reachable from users). Applies to PUT and GET presigns when `S3_PRESIGN_ENDPOINT` is set. */
export function rewritePresignedPutUrlForBrowser(url: string): string {
  const publicBase = String(process.env.S3_PRESIGN_ENDPOINT || '').trim()
  if (!publicBase) return url
  try {
    const u = new URL(url)
    const pub = new URL(publicBase.includes('://') ? publicBase : `http://${publicBase}`)
    u.protocol = pub.protocol
    u.host = pub.host
    u.port = pub.port
    return u.toString()
  } catch {
    return url
  }
}

const PRESIGN_PUT_EXPIRES = 5 * 60 // 5 min
const PRESIGN_GET_EXPIRES = 60 * 60 // 1 h

export async function createPresignedPutUrl(objectKey: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: objectKey })
  return getSignedUrl(s3Client as any, command, { expiresIn: PRESIGN_PUT_EXPIRES })
}

export async function createPresignedGetUrl(objectKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey })
  return getSignedUrl(s3Client as any, command, { expiresIn: PRESIGN_GET_EXPIRES })
}

export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }))
    return true
  } catch {
    return false
  }
}
