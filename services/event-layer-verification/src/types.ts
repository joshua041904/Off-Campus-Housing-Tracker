/**
 * Types for event-layer verification tests.
 * Align with docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md and proto/events/envelope.proto.
 */

export interface OutboxRow {
  id: string
  aggregate_id: string
  type: string
  version: number
  payload: Buffer
  created_at: Date
  published: boolean
}

export interface EventEnvelope {
  event_id: string
  type: string
  version: number
  source: string
  entity_id: string
  timestamp: string
  payload: Buffer
}
