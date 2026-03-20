/**
 * Kafka events for messaging + forum. Contract: proto/events/messaging/v1/messaging_events.proto
 * Topic: messaging.events.v1 (strict; not legacy social/RP topic names).
 * Payloads are JSON matching the proto field names (immutable, versioned schemas).
 */
import { randomUUID } from 'node:crypto'

export const MESSAGING_EVENTS_TOPIC = 'messaging.events.v1'

const PRODUCER = 'messaging-service'
const SCHEMA_VERSION = '1'

export type EventMetadataJson = {
  event_id: string
  event_type: string
  aggregate_id: string
  aggregate_type: string
  occurred_at: string
  correlation_id: string
  causation_id: string
  producer: string
  version: string
}

export function buildMetadata(params: {
  event_type: string
  aggregate_id: string
  aggregate_type: string
  correlation_id?: string
  causation_id?: string
}): EventMetadataJson {
  return {
    event_id: randomUUID(),
    event_type: params.event_type,
    aggregate_id: params.aggregate_id,
    aggregate_type: params.aggregate_type,
    occurred_at: new Date().toISOString(),
    correlation_id: params.correlation_id ?? '',
    causation_id: params.causation_id ?? '',
    producer: PRODUCER,
    version: SCHEMA_VERSION,
  }
}

/** Send one JSON event to messaging.events.v1. Key = partition key (e.g. aggregate_id). */
export async function sendMessagingEvent(
  producer: { send: (args: { topic: string; messages: Array<{ key: string; value: string }> }) => Promise<unknown> },
  partitionKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  await producer.send({
    topic: MESSAGING_EVENTS_TOPIC,
    messages: [{ key: partitionKey, value: JSON.stringify(payload) }],
  })
}
