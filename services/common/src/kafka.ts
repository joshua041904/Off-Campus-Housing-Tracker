import { Kafka } from 'kafkajs'
import * as fs from 'fs'

// Strict TLS: no plaintext. When KAFKA_SSL_ENABLED=true, require CA + client cert + key (mTLS).
// Env: KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or legacy KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY).
// Missing cert paths → throw (startup fails). No plaintext fallback.

/** For tests: validate TLS env and return config or throw. Use env param to avoid process.env at load time. */
export function getKafkaSslConfigForTest(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  if (env.KAFKA_SSL_ENABLED !== 'true') return undefined
  const caPath = env.KAFKA_CA_CERT || env.KAFKA_SSL_CA_PATH
  const certPath = env.KAFKA_CLIENT_CERT || env.KAFKA_SSL_CERT_PATH
  const keyPath = env.KAFKA_CLIENT_KEY || env.KAFKA_SSL_KEY_PATH
  if (!caPath || !certPath || !keyPath) {
    throw new Error(
      'KAFKA_SSL_ENABLED=true requires all cert paths. Set KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY). No plaintext fallback.'
    )
  }
  return {
    rejectUnauthorized: true,
    ca: [fs.readFileSync(caPath, 'utf-8')],
    cert: fs.readFileSync(certPath, 'utf-8'),
    key: fs.readFileSync(keyPath, 'utf-8'),
  }
}

const sslConfig = process.env.KAFKA_SSL_ENABLED === 'true' ? (() => {
  try {
    const caPath = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH
    const certPath = process.env.KAFKA_CLIENT_CERT || process.env.KAFKA_SSL_CERT_PATH
    const keyPath = process.env.KAFKA_CLIENT_KEY || process.env.KAFKA_SSL_KEY_PATH

    if (!caPath || !certPath || !keyPath) {
      const msg = '[kafka] KAFKA_SSL_ENABLED=true requires all cert paths. Set KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY). No plaintext fallback.'
      console.error(msg)
      throw new Error(msg)
    }

    const config: Record<string, unknown> = {
      rejectUnauthorized: true,
      ca: [fs.readFileSync(caPath, 'utf-8')],
      cert: fs.readFileSync(certPath, 'utf-8'),
      key: fs.readFileSync(keyPath, 'utf-8'),
    }
    return config
  } catch (error) {
    console.error('[kafka] Error loading SSL certificates:', error)
    throw error
  }
})() : undefined

// Determine broker port based on SSL configuration
const brokerPort = sslConfig ? '9093' : '9092'
const brokerHost = process.env.KAFKA_BROKER?.split(':')[0] || 'kafka'
const broker = process.env.KAFKA_BROKER || `${brokerHost}:${brokerPort}`

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'off-campus-housing-tracker',
  brokers: [broker],
  ssl: sslConfig,
  // Keep broker connect bounded so a bad Endpoint does not stall the Node event loop (gRPC health still responds).
  connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || '4000'),
  requestTimeout: 25000,
  retry: {
    retries: Number(process.env.KAFKAJS_METADATA_RETRIES || '4'),
    initialRetryTime: 100,
    maxRetryTime: 15000,
  }
})

/**
 * Check that Kafka broker is reachable. Use in health checks for services that depend on Kafka.
 * Creates an admin client, connects, then disconnects. Returns true if reachable, false otherwise.
 */
export async function checkKafkaConnectivity(): Promise<boolean> {
  const admin = kafka.admin()
  try {
    await admin.connect()
    await admin.disconnect()
    return true
  } catch (err) {
    return false
  }
}
