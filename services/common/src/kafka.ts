import { Kafka } from 'kafkajs'
import * as fs from 'fs'

// Strict TLS configuration: no cleartext. All Kafka client connections use SSL (port 9093).
// Set KAFKA_SSL_ENABLED=true to enable TLS connections (required by platform policy).
// When enabled, must provide KAFKA_CA_CERT; optionally KAFKA_CLIENT_CERT/KAFKA_CLIENT_KEY for mTLS.
const sslConfig = process.env.KAFKA_SSL_ENABLED === 'true' ? (() => {
  try {
    const config: any = {
      rejectUnauthorized: true, // Strict TLS - reject self-signed certificates
    }
    
    if (process.env.KAFKA_CA_CERT) {
      config.ca = [fs.readFileSync(process.env.KAFKA_CA_CERT, 'utf-8')]
    }
    
    if (process.env.KAFKA_CLIENT_CERT) {
      config.cert = fs.readFileSync(process.env.KAFKA_CLIENT_CERT, 'utf-8')
    }
    
    if (process.env.KAFKA_CLIENT_KEY) {
      config.key = fs.readFileSync(process.env.KAFKA_CLIENT_KEY, 'utf-8')
    }
    
    // Strict TLS: do not fall back to PLAINTEXT when SSL is enabled. Require at least CA or client cert.
    if (!config.ca && !config.cert) {
      const msg = '[kafka] KAFKA_SSL_ENABLED=true but no certificates provided. Set KAFKA_CA_CERT (and optionally KAFKA_CLIENT_CERT/KAFKA_CLIENT_KEY for mTLS). No plaintext fallback.'
      console.error(msg)
      throw new Error(msg)
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
  // Strict connection settings
  connectionTimeout: 3000,
  requestTimeout: 25000,
  retry: {
    retries: 8,
    initialRetryTime: 100,
    maxRetryTime: 30000,
  }
})
