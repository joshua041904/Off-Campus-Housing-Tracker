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

const PRESIGN_PUT_EXPIRES = 5 * 60 // 5 min
const PRESIGN_GET_EXPIRES = 60 * 60 // 1 h

export async function createPresignedPutUrl(objectKey: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: objectKey })
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_PUT_EXPIRES })
}

export async function createPresignedGetUrl(objectKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey })
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_GET_EXPIRES })
}

export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }))
    return true
  } catch {
    return false
  }
}
