import { checkConnection } from './db/mediaRepo.js'
import { checkKafkaConnectivity } from '@common/utils/kafka'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'

const bucket = process.env.S3_BUCKET || 'housing-media'
const endpoint = process.env.S3_ENDPOINT || 'http://minio:9000'
const region = process.env.S3_REGION || 'us-east-1'

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
})

export async function checkS3Connectivity(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    return true
  } catch {
    return false
  }
}

/** Combined health: DB + Kafka + S3. Fail if any required dependency is down. */
export async function healthCheck(): Promise<boolean> {
  const [db, kafka, s3Ok] = await Promise.all([
    checkConnection(),
    checkKafkaConnectivity(),
    checkS3Connectivity(),
  ])
  return db && kafka && s3Ok
}
