import { ensureKafkaBrokerReady } from '@common/utils/kafka'
import { startGrpcServer } from './grpc-server.js'
import { startMediaHttpServer } from './http-server.js'

const grpcPort = parseInt(process.env.GRPC_PORT || '50052', 10)
const httpPort = parseInt(process.env.HTTP_PORT || '4018', 10)

async function main() {
  await ensureKafkaBrokerReady('media-service')
  console.log(
    `[media-service] starting HTTP on ${httpPort}, gRPC on ${grpcPort} (NODE_ENV=${process.env.NODE_ENV || 'unset'})`
  )
  startMediaHttpServer(httpPort)
  startGrpcServer(grpcPort)
}

void main().catch((e) => {
  console.error('[media-service] fatal startup error:', e)
  process.exit(1)
})
