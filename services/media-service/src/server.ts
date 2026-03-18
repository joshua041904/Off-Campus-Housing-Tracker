import { startGrpcServer } from './grpc-server.js'

const port = parseInt(process.env.GRPC_PORT || '50052', 10)
startGrpcServer(port)
