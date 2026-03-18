import { describe, it, expect } from 'vitest'
import { getKafkaSslConfigForTest } from './kafka.js'

describe('Kafka strict TLS', () => {
  it('requires all cert paths when KAFKA_SSL_ENABLED=true (startup fails if missing)', () => {
    const env = {
      KAFKA_SSL_ENABLED: 'true',
      KAFKA_SSL_CA_PATH: '',
      KAFKA_SSL_CERT_PATH: '',
      KAFKA_SSL_KEY_PATH: '',
    } as NodeJS.ProcessEnv
    expect(() => getKafkaSslConfigForTest(env)).toThrow(/KAFKA_SSL_ENABLED=true requires all cert paths/)
  })
})
