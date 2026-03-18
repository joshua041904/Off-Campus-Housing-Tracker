/**
 * Entry: start gRPC server for MessagingService.
 */
import { startGrpcServer } from './grpc-server.js'

const port = parseInt(process.env.GRPC_PORT || process.env.MESSAGING_GRPC_PORT || '50064', 10)
startGrpcServer(port)
