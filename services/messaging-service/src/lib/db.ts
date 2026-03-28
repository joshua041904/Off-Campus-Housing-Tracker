import { Pool } from 'pg'

// Messaging DB: POSTGRES_URL_MESSAGING (housing) or POSTGRES_URL_SOCIAL (legacy) or build from MESSAGING_DB_*
const host = process.env.MESSAGING_DB_HOST || process.env.PGHOST || '127.0.0.1'
const port = parseInt(process.env.MESSAGING_DB_PORT || process.env.PGPORT || '5444', 10)
const user = process.env.PGUSER || 'postgres'
const password = process.env.PGPASSWORD || 'postgres'
const database = process.env.MESSAGING_DB_NAME || 'messaging'

const connectionString =
  process.env.POSTGRES_URL_MESSAGING ||
  process.env.POSTGRES_URL_SOCIAL ||
  process.env.DATABASE_URL ||
  `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=5`

if (!process.env.POSTGRES_URL_MESSAGING && !process.env.POSTGRES_URL_SOCIAL && !process.env.DATABASE_URL) {
  console.log('[messaging] Using MESSAGING_DB_* env for DB connection')
}

export const pool = new Pool({
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX || '50', 10),
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

const inflightLimitRaw = Number(process.env.MAX_DB_CONCURRENCY || process.env.DB_POOL_MAX || '50')
const inflightLimit = Number.isFinite(inflightLimitRaw) && inflightLimitRaw > 0 ? Math.floor(inflightLimitRaw) : 50

function attachConcurrencyGuard(target: InstanceType<typeof Pool>, maxInflight: number): void {
  const originalQuery = target.query.bind(target) as (...args: any[]) => Promise<any>
  let inflight = 0
  const waiters: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    if (inflight < maxInflight) {
      inflight += 1
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    inflight += 1
  }
  const release = (): void => {
    inflight = Math.max(0, inflight - 1)
    const next = waiters.shift()
    if (next) next()
  }
  ;(target as any).query = async (...args: any[]): Promise<any> => {
    await acquire()
    try {
      return await originalQuery(...args)
    } finally {
      release()
    }
  }
}

attachConcurrencyGuard(pool, inflightLimit)

pool.on('error', (err) => {
  console.error('[messaging] Unexpected DB pool error:', err)
})

export interface ForumPost {
  id: string
  user_id: string
  title: string
  content: string
  flair: string
  upvotes: number
  downvotes: number
  comment_count: number
  is_pinned: boolean
  is_locked: boolean
  created_at: Date
  updated_at: Date
}

export interface ForumComment {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  content: string
  upvotes: number
  downvotes: number
  created_at: Date
  updated_at: Date
}

export interface Message {
  id: string
  sender_id: string
  recipient_id: string | null
  parent_message_id: string | null
  thread_id: string | null
  message_type: string
  subject: string
  content: string
  is_read: boolean
  created_at: Date
  updated_at: Date
}
