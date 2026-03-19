import { getRedis } from '@common/utils/redis'

const PREFIX = 'rate:msg:'
const WINDOW_SEC = 60
const MAX_PER_MINUTE = 30
const MAX_PER_DAY = 500
const DAY_SEC = 86400

/**
 * Check and increment message rate limit for user. Uses Redis: rate:msg:{user_id} (per minute), rate:msg:day:{user_id} (per day).
 * Rules: 30 messages/minute, 500/day. If exceeded, throws RATE_LIMIT_EXCEEDED (caller should map to gRPC RESOURCE_EXHAUSTED).
 * Redis down: fail safe by blocking (throw so SendMessage fails; do not allow unlimited sends).
 */
export async function checkAndIncrement(userId: string): Promise<void> {
  const redis = getRedis()
  const keyMin = `${PREFIX}${userId}`
  const keyDay = `${PREFIX}day:${userId}`

  let countMin: number
  let countDay: number

  try {
    // ioredis can be in "wait"/"connecting" when the first test call arrives.
    // With offline queue disabled, commands issued too early throw stream errors.
    const status = (redis as any).status as string
    if (status === 'wait') {
      await redis.connect()
    } else if (status === 'connecting') {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Redis connect timeout')), 5000)
        const cleanup = () => {
          clearTimeout(t)
          ;(redis as any).off?.('ready', onReady)
          ;(redis as any).off?.('error', onError)
        }
        const onReady = () => {
          cleanup()
          resolve()
        }
        const onError = (err: unknown) => {
          cleanup()
          reject(err)
        }
        ;(redis as any).once?.('ready', onReady)
        ;(redis as any).once?.('error', onError)
      })
    }
    const multi = redis.multi()
    multi.incr(keyMin)
    multi.expire(keyMin, WINDOW_SEC)
    multi.incr(keyDay)
    multi.expire(keyDay, DAY_SEC)
    const results = await multi.exec()
    if (!results || results.length < 2) throw new Error('Redis multi failed')
    countMin = results[0]?.[1] as number
    countDay = results[2]?.[1] as number
  } catch (err) {
    console.error('[rateLimit] Redis error:', err)
    throw new Error('RATE_LIMIT_UNAVAILABLE')
  }

  if (countMin > MAX_PER_MINUTE) {
    throw new Error('RATE_LIMIT_EXCEEDED_PER_MINUTE')
  }
  if (countDay > MAX_PER_DAY) {
    throw new Error('RATE_LIMIT_EXCEEDED_PER_DAY')
  }
}
