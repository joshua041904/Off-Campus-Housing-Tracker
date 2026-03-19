/**
 * Entry: HTTP (4014) + gRPC (50064) for MessagingService.
 */
import http from 'node:http'
import { startGrpcServer } from './grpc-server.js'

const httpPort = parseInt(process.env.HTTP_PORT || '4014', 10)
const grpcPort = parseInt(process.env.GRPC_PORT || process.env.MESSAGING_GRPC_PORT || '50064', 10)

const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(404)
  res.end()
})
httpServer.listen(httpPort, '0.0.0.0', () => {
  console.log(`[messaging] HTTP server listening on port ${httpPort}`)
})

startGrpcServer(grpcPort)
