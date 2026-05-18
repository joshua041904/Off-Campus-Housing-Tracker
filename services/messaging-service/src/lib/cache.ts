// Cache helpers for messaging-service (forum + DMs). Key prefix: messaging.
import Redis from 'ioredis'
import { readFileSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'

const DBG = process.env.DEBUG_CACHE === '1'
const MAX_BYTES = Number(process.env.CACHE_MAX_BYTES ?? 524_288)
const SF_STALE_MS = Number(process.env.CACHE_SINGLEFLIGHT_STALE_MS ?? 2000)
const SF_SLEEP_MS = Number(process.env.CACHE_SINGLEFLIGHT_SLEEP_MS ?? 75)

const SINGLEFLIGHT_SCRIPT = readFileSync(
  join(__dirname, 'singleflight_cache.lua'),
  'utf8'
)
let singleflightSha: string | undefined

async function ensureSingleflightScript(r: Redis): Promise<string> {
  if (singleflightSha) return singleflightSha
  const sha = (await (r as any).script('LOAD', SINGLEFLIGHT_SCRIPT)) as string
  singleflightSha = sha
  return sha
}

/** Run singleflight Lua via EVALSHA; on NOSCRIPT reload once; final fallback EVAL (cold Redis / FLUSHDB). */
async function evalSingleflight(
  r: Redis,
  dataKey: string,
  lockKey: string,
  ttlSec: number,
): Promise<[string, string] | null> {
  const argv = [String(ttlSec), String(Date.now()), String(SF_STALE_MS)] as const
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const sha = await ensureSingleflightScript(r)
      return (await (r as any).evalsha(sha, 2, dataKey, lockKey, ...argv)) as [string, string]
    } catch (err: unknown) {
      const msg = String((err as { message?: unknown })?.message ?? err)
      if (msg.includes('NOSCRIPT')) {
        singleflightSha = undefined
        continue
      }
      console.error('[cache singleflight]', err)
      return null
    }
  }
  try {
    return (await (r as any).eval(SINGLEFLIGHT_SCRIPT, 2, dataKey, lockKey, ...argv)) as [string, string]
  } catch (err: unknown) {
    console.error('[cache singleflight eval]', err)
    return null
  }
}

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')

function jitter(ms: number) {
  const low = ms * 0.9
  const high = ms * 1.1
  return Math.round(low + Math.random() * (high - low))
}

export function normalizeQ(input: string): string {
  return String(input || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function makeRedis(): Redis | null {
  const url = process.env.REDIS_URL || ''
  const password = process.env.REDIS_PASSWORD || undefined
  const useTLS = !!process.env.REDIS_TLS

  const common = {
    password,
    enableAutoPipelining: true,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    keepAlive: 10_000,
    autoResubscribe: false,
  } as const

  const client = url
    ? new Redis(url, { ...common, tls: useTLS ? {} : undefined })
    : new Redis({
        host:
          process.env.REDIS_HOST ||
          (process.env.NODE_ENV === 'test'
            ? '127.0.0.1'
            : 'redis-external.off-campus-housing-tracker.svc.cluster.local'),
        port: Number(process.env.REDIS_PORT || 6380),
        ...common,
      })

  client.on('error', (e: unknown) => {
    const msg = (e as { message?: unknown })?.message ?? e
    console.error('[redis]', msg)
  })
  client.connect().catch(() => {})
  return client
}

function stringifySafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v !== 'bigint') return v
    const abs = v < 0n ? -v : v
    return abs <= 9007199254740991n ? Number(v) : v.toString()
  })
}

export async function cached<T>(
  r: Redis | null,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  if (!r || ttlMs <= 0) return compute()

  const lockKey = `messaging:sf:lock:${sha1(key)}`
  const ttlSec = Math.ceil(ttlMs / 1000)
  let state: string | null = null
  let payload: string | null = null

  try {
    const res = await evalSingleflight(r, key, lockKey, ttlSec)
    if (res) {
      state = res[0] ?? null
      payload = res[1] ?? null
    }
  } catch {
    /* evalSingleflight logs */
  }

  if (state === 'hit' && payload) {
    if (DBG) console.log('[cache] HIT', key)
    return JSON.parse(payload) as T
  }

  try {
    const hit = await r.get(key)
    if (hit != null) {
      if (DBG) console.log('[cache] HIT', key)
      return JSON.parse(hit) as T
    }
  } catch (e: any) {
    console.error('[redis get]', e?.message ?? e)
  }

  const hadLock = state === 'miss-locked'
  let haveLock = hadLock

  if (!hadLock && state === 'miss-wait') {
    const got = (await r.setnx(lockKey, '1')) === 1
    if (got) {
      await r.pexpire(lockKey, 10_000)
      haveLock = true
    } else {
      if (DBG) console.log('[cache] miss-wait', key)
      await new Promise((resolve) => setTimeout(resolve, SF_SLEEP_MS))
      const again = await r.get(key)
      if (again) return JSON.parse(again) as T
    }
  }

  const val = await compute()

  try {
    const json = stringifySafe(val)
    const bytes = Buffer.byteLength(json)
    if (bytes <= MAX_BYTES) {
      const ttl = Math.max(1_000, jitter(ttlMs))
      if (haveLock) {
        await r.multi().psetex(key, ttl, json).del(lockKey).exec()
      } else {
        await r.psetex(key, ttl, json)
      }
      if (DBG) console.log('[cache] SET', key, 'ttlMs', ttl, 'bytes', bytes)
    } else if (DBG) {
      console.log('[cache] SKIP(set too big)', key, 'bytes', bytes)
    }
  } catch (e: any) {
    console.error('[redis set]', e?.message ?? e)
  }

  return val
}

export function ckey(parts: Array<string | number | boolean | null | undefined>) {
  return parts.map((p) => (p == null ? '' : String(p))).join(':')
}

export function makePostKey(postId: string): string {
  return ckey(['messaging', 'post', postId])
}

export function makePostsListKey(page: number, limit: number, flair?: string): string {
  return ckey(['messaging', 'posts', 'list', page, limit, flair || ''])
}

export function makeCommentsKey(postId: string): string {
  return ckey(['messaging', 'comments', postId])
}

export function makeMessagesKey(
  userId: string,
  page: number,
  limit: number,
  type?: string,
  includeArchived?: boolean,
): string {
  return ckey(['messaging', 'messages', userId, page, limit, type || '', includeArchived ? 'ia1' : 'ia0'])
}

export function makeThreadKey(threadId: string, includeArchived?: boolean): string {
  return ckey(['messaging', 'thread', threadId, includeArchived ? 'ia1' : 'ia0'])
}

/** After forum vote changes, drop cached post body, comments tree, and post list pages. */
export async function invalidateForumVoteCaches(r: Redis | null, postId: string): Promise<void> {
  if (!r) return
  try {
    await r.del(makePostKey(postId)).catch(() => {})
    await r.del(makeCommentsKey(postId)).catch(() => {})
    const stream = r.scanStream({ match: 'messaging:posts:list:*', count: 200 })
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (keys?.length) void r.del(...keys).catch(() => {})
      })
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
  } catch (e) {
    console.warn('[cache] invalidateForumVoteCaches', e)
  }
}
