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
