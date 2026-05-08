/**
 * HTTP listener for media-service (health + REST under /media/*).
 * gRPC remains the primary API for in-cluster callers; gateway may proxy HTTP.
 */
import { createMediaHttpApp } from './http-app.js'

export function startMediaHttpServer(port: number): void {
  const app = createMediaHttpApp()
  app.listen(port, '0.0.0.0', () => {
    console.log(`[media-service] HTTP listening on 0.0.0.0:${port} (/healthz, /media/*)`)
  })
}
