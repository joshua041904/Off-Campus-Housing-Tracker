/**
 * Canonical outbox publisher step for one row.
 * Order: produce → (hook) → update → (hook) → commit.
 * Used by event-layer break tests to verify ordering and failure behavior.
 * Contract: docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md, docs/EVENT_LAYER_STABILITY.md.
 */

import type { OutboxRow, EventEnvelope } from './types.js'
import type { MockOutboxDb } from './mocks.js'
import type { MockProducer } from './mocks.js'

export interface PublisherHooks {
  /** Called after produce succeeds, before UPDATE. Throw to simulate crash after produce. */
  afterProduce?: () => void
  /** Called after UPDATE, before commit. Throw to simulate crash before commit (rollback). */
  afterUpdateBeforeCommit?: () => void
}

function rowToEnvelope(row: OutboxRow, source: string): EventEnvelope {
  return {
    event_id: row.id,
    type: row.type,
    version: row.version,
    source,
    entity_id: row.aggregate_id,
    timestamp: row.created_at.toISOString(),
    payload: Buffer.from(row.payload),
  }
}

export interface ProcessOneRowDeps {
  db: MockOutboxDb
  producer: MockProducer
  topic: string
  source: string
}

/**
 * Process one outbox row: produce → update → commit.
 * On any throw, we do not commit (so update is rolled back in the mock).
 */
export async function processOneRow(
  deps: ProcessOneRowDeps,
  row: OutboxRow,
  hooks: PublisherHooks = {}
): Promise<void> {
  const { db, producer, topic, source } = deps
  const envelope = rowToEnvelope(row, source)

  // 1. Produce to Kafka (await success)
  await producer.send(topic, row.aggregate_id, envelope)

  // 2. Hook: crash after produce (before UPDATE)
  if (hooks.afterProduce) hooks.afterProduce()

  // 3. Only after successful produce: UPDATE published = true
  db.updatePublished(row.id)

  // 4. Hook: crash after UPDATE but before commit (simulate rollback)
  try {
    if (hooks.afterUpdateBeforeCommit) hooks.afterUpdateBeforeCommit()
  } catch (e) {
    db.rollback()
    throw e
  }

  // 5. Commit the transaction
  db.commit()
}
