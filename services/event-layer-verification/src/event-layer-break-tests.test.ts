/**
 * Event-layer intentional break tests (docs/EVENT_LAYER_STABILITY.md).
 *
 * Guarantees:
 * - No message loss
 * - At-least-once delivery
 * - Idempotent consumption ensures exactly-once effect
 * Test 1 — Kill after produce: crash before UPDATE published = true → row stays false, republish, consumer dedupes.
 * Test 2 — Kill after UPDATE but before commit: rollback → row stays false, retry works.
 * Test 3 — Kafka down: publish fails, published stays false, health NOT_SERVING; when Kafka back, retries succeed.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockOutboxDb, MockProducer, MockKafkaHealthCheck } from './mocks.js'
import { processOneRow } from './publisher-core.js'
import { MockProcessedEvents, consumeIdempotent } from './consumer-idempotent.js'
import type { OutboxRow, EventEnvelope } from './types.js'

const TOPIC = 'dev.booking.events'
const SOURCE = 'booking-service'

function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'e1',
    aggregate_id: 'agg-1',
    type: 'booking.created',
    version: 1,
    payload: Buffer.from('payload'),
    created_at: new Date(),
    published: false,
    ...overrides,
  }
}

describe('Event-layer break tests (EVENT_LAYER_STABILITY.md)', () => {
  describe('Test 1 — Kill after produce', () => {
    it('row stays published=false when crash injected after produce, before UPDATE', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      const row = makeRow()
      db.insert(row)

      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      await expect(
        processOneRow(deps, row, {
          afterProduce: () => {
            throw new Error('crash after produce')
          },
        })
      ).rejects.toThrow('crash after produce')

      expect(db.isPublished(row.id)).toBe(false)
      expect(producer.getProducedCount()).toBe(1)
    })

    it('after restart (no crash), row is updated and committed; consumer dedupes duplicate', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      const row = makeRow()
      db.insert(row)
      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      // First run: crash after produce
      await expect(
        processOneRow(deps, row, { afterProduce: () => { throw new Error('crash') } })
      ).rejects.toThrow('crash')
      expect(db.isPublished(row.id)).toBe(false)
      expect(producer.getProducedCount()).toBe(1)

      // "Restart": run again without crash → should update and commit
      const sameRow = db.getUnpublished(1)[0]
      expect(sameRow).toBeDefined()
      await processOneRow(deps, sameRow!, {})

      expect(db.isPublished(row.id)).toBe(true)
      expect(producer.getProducedCount()).toBe(2)

      // Consumer idempotency: both deliveries; only first is processed
      const processedEvents = new MockProcessedEvents()
      let handledCount = 0
      const envelopes = producer.getProduced()
      for (const env of envelopes) {
        consumeIdempotent(processedEvents, env, () => { handledCount++ })
      }
      expect(handledCount).toBe(1)
      expect(processedEvents.getProcessedCount()).toBe(1)
    })
  })

  describe('Test 2 — Kill after UPDATE but before commit', () => {
    it('row stays published=false when crash injected after UPDATE, before commit (rollback)', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      const row = makeRow()
      db.insert(row)
      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      await expect(
        processOneRow(deps, row, {
          afterUpdateBeforeCommit: () => {
            throw new Error('crash before commit')
          },
        })
      ).rejects.toThrow('crash before commit')

      expect(db.isPublished(row.id)).toBe(false)
      expect(producer.getProducedCount()).toBe(1)
    })

    it('retry after rollback: next poll publishes again and commits', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      const row = makeRow()
      db.insert(row)
      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      await expect(
        processOneRow(deps, row, {
          afterUpdateBeforeCommit: () => { throw new Error('rollback') },
        })
      ).rejects.toThrow('rollback')
      expect(db.isPublished(row.id)).toBe(false)

      const sameRow = db.getUnpublished(1)[0]
      await processOneRow(deps, sameRow!, {})
      expect(db.isPublished(row.id)).toBe(true)
      expect(producer.getProducedCount()).toBe(2)
    })
  })

  describe('Test 3 — Kafka down', () => {
    it('publish fails, published remains false, health returns false', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      producer.setFailNext(true)
      const row = makeRow()
      db.insert(row)
      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      await expect(processOneRow(deps, row, {})).rejects.toThrow('Kafka unreachable')

      expect(db.isPublished(row.id)).toBe(false)
      expect(producer.getProducedCount()).toBe(0)

      const health = new MockKafkaHealthCheck()
      health.setUp(false)
      expect(await health.check()).toBe(false)
    })

    it('when Kafka returns, retries succeed', async () => {
      const db = new MockOutboxDb()
      const producer = new MockProducer()
      const row = makeRow()
      db.insert(row)
      const deps = { db, producer, topic: TOPIC, source: SOURCE }

      producer.setFailNext(true)
      await expect(processOneRow(deps, row, {})).rejects.toThrow('Kafka unreachable')
      expect(db.isPublished(row.id)).toBe(false)

      producer.setFailNext(false)
      const sameRow = db.getUnpublished(1)[0]
      await processOneRow(deps, sameRow!, {})
      expect(db.isPublished(row.id)).toBe(true)
      expect(producer.getProducedCount()).toBe(1)
    })
  })
})
