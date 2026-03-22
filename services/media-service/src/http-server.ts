/**
 * Minimal HTTP surface for api-gateway and k6: health only.
 * gRPC (50068) remains the primary API; gateway proxies /media/* to this port per README.
 */
import http from 'node:http'
import { checkConnection } from './db/mediaRepo.js'

export function startMediaHttpServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    const path = req.url?.split('?')[0] || ''
    if (path === '/healthz' || path === '/health' || path === '/health/') {
      try {
        const dbOk = await checkConnection()
        const body = JSON.stringify({
          ok: dbOk,
          db: dbOk ? 'connected' : 'disconnected',
          service: 'media-service',
        })
        res.statusCode = dbOk ? 200 : 503
        res.setHeader('Content-Type', 'application/json')
        res.end(body)
      } catch {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, db: 'error', service: 'media-service' }))
      }
      return
    }
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not found' }))
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`[media-service] HTTP listening on 0.0.0.0:${port} (/healthz)`)
  })
}
