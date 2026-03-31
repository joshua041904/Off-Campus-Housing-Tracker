import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { createUploadUrl } from './handlers/createUploadUrl.js'
import { completeUpload } from './handlers/completeUpload.js'
import { getDownloadUrl } from './handlers/getDownloadUrl.js'
import { registerHealthService } from '@common/utils/grpc-health'
import { createOchGrpcServerCredentialsForBind } from '@common/utils/grpc-server-credentials'
import { resolveProtoPath } from '@common/utils/proto'
import { checkConnection } from './db/mediaRepo.js'

const MEDIA_PROTO = resolveProtoPath('media.proto')
const packageDefinition = protoLoader.loadSync(MEDIA_PROTO, { keepCase: true, longs: String, enums: String, defaults: true })
const mediaProto = (grpc.loadPackageDefinition(packageDefinition) as any).media
if (!mediaProto?.MediaService?.service) {
  console.error('[media gRPC] invalid media.proto load — expected package media with MediaService')
  process.exit(1)
}

export function startGrpcServer(port: number): void {
  const server = new grpc.Server()

  server.addService(mediaProto.MediaService.service, {
    CreateUploadUrl: async (call: any, callback: any) => {
      try {
        const { user_id, filename, content_type, size_bytes } = call.request
        const result = await createUploadUrl({ userId: user_id, filename, contentType: content_type, sizeBytes: Number(size_bytes) })
        callback(null, {
          media_id: result.mediaId,
          upload_url: result.uploadUrl,
          object_key: result.objectKey,
          expires_at: result.expiresAt,
        })
      } catch (e: any) {
        if (e.message === 'INVALID_FILE_TYPE' || e.message === 'INVALID_FILE_SIZE') {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: e.message })
        } else {
          callback({ code: grpc.status.INTERNAL, message: e?.message || 'Internal error' })
        }
      }
    },
    CompleteUpload: async (call: any, callback: any) => {
      try {
        const success = await completeUpload(call.request.media_id)
        callback(null, { success })
      } catch (e: any) {
        callback({ code: grpc.status.INTERNAL, message: e?.message || 'Internal error' })
      }
    },
    GetDownloadUrl: async (call: any, callback: any) => {
      try {
        const result = await getDownloadUrl(call.request.media_id)
        if (!result) {
          callback({ code: grpc.status.NOT_FOUND, message: 'Media not found or not uploaded' })
          return
        }
        callback(null, { download_url: result.downloadUrl, expires_at: result.expiresAt })
      } catch (e: any) {
        callback({ code: grpc.status.INTERNAL, message: e?.message || 'Internal error' })
      }
    },
  })

  // K8s grpc-health-probe: DB only (same pattern as listings). Full DB+Kafka+S3: see health.ts for future HTTP readiness.
  registerHealthService(server, 'media.MediaService', async () => checkConnection())

  let credentials: grpc.ServerCredentials
  try {
    credentials = createOchGrpcServerCredentialsForBind('media gRPC')
  } catch (e) {
    console.error(e)
    process.exit(1)
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, p) => {
    if (err) {
      console.error('[media gRPC] bind error:', err)
      process.exit(1)
    }
    console.log(`[media gRPC] listening on ${p}`)
  })
}
