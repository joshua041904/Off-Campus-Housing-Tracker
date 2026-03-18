import Redis from 'ioredis'

let client: Redis | null = null

/** Singleton Redis client. Why: avoid multiple TCP connections per worker. */
export function getRedis(): Redis {
  if (!client) {
    // Support both REDIS_URL (with password) and REDIS_PASSWORD env var
    let url = process.env.REDIS_URL || 'redis://redis:6379/0'
    const rawPassword = process.env.REDIS_PASSWORD
    // Treat empty string as no password (externalized Redis often has no requirepass)
    const password = rawPassword && String(rawPassword).trim() ? rawPassword : undefined
    // If REDIS_PASSWORD is set and URL doesn't have password, add it
    if (password && !url.includes('@') && !url.includes('://:')) {
      // Insert password after redis://
      url = url.replace('redis://', `redis://:${password}@`)
    }
    client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 10_000, // host.docker.internal/Colima may need a moment on first packet
      maxRetriesPerRequest: 5,
      password: password,
      retryStrategy: (times) => {
        if (times > 5) return null
        return Math.min(times * 200, 3000)
      },
      enableOfflineQueue: false,
    })
    // Handle errors gracefully - don't crash the app
    client.on('error', (err) => {
      console.warn('[redis] Connection error (non-fatal):', err.message);
    });
  }
  return client
}

/** Simple cache get/set with TTL seconds. */
export async function cache<T = unknown>(key: string, loader: () => Promise<T>, ttlSec = 60): Promise<T> {
  const r = getRedis()
  const hit = await r.get(key)
  if (hit) return JSON.parse(hit) as T
  const data = await loader()
  await r.set(key, JSON.stringify(data), 'EX', ttlSec)
  return data
}
