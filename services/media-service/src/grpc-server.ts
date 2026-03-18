import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as fs from 'fs'
import * as path from 'path'
import { createUploadUrl } from './handlers/createUploadUrl.js'
import { completeUpload } from './handlers/completeUpload.js'
import { getDownloadUrl } from './handlers/getDownloadUrl.js'
import { registerHealthService } from '@common/utils/grpc-health'
import { healthCheck } from './health.js'

const PROTO_PATH = path.resolve(__dirname, '../../../proto/media.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true })
const mediaProto = (grpc.loadPackageDefinition(packageDefinition) as any).media

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

  registerHealthService(server, 'media.MediaService', healthCheck)

  const certsDir = path.resolve(__dirname, '../../../certs')
  const keyPath = process.env.TLS_KEY_PATH || path.join(certsDir, 'media-service.key')
  const certPath = process.env.TLS_CERT_PATH || path.join(certsDir, 'media-service.crt')
  const caPath = process.env.TLS_CA_PATH || process.env.GRPC_CA_CERT || path.join(certsDir, 'dev-root.pem')
  const requireClientCert = process.env.GRPC_REQUIRE_CLIENT_CERT === 'true'

  let credentials: grpc.ServerCredentials
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath)
    const cert = fs.readFileSync(certPath)
    const rootCerts = fs.existsSync(caPath) ? fs.readFileSync(caPath) : null
    credentials = grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: key, cert_chain: cert }], requireClientCert as any)
    console.log('[media gRPC] TLS enabled; client cert required:', requireClientCert)
  } else {
    console.warn('[media gRPC] TLS certs not found, starting insecure (dev only)')
    credentials = grpc.ServerCredentials.createInsecure()
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, p) => {
    if (err) {
      console.error('[media gRPC] bind error:', err)
      return
    }
    server.start()
    console.log(`[media gRPC] listening on ${p}`)
  })
}
