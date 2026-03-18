/**
 * Idempotent consumer simulation for break tests.
 * Contract: insert event_id before handle; on conflict skip (docs/CONSUMER_WIRING.md).
 */

import type { EventEnvelope } from './types.js'

export class MockProcessedEvents {
  private processed = new Set<string>()

  /** Returns true if this event was already processed (duplicate). */
  tryInsert(eventId: string): boolean {
    if (this.processed.has(eventId)) return false
    this.processed.add(eventId)
    return true
  }

  getProcessedCount(): number {
    return this.processed.size
  }

  clear(): void {
    this.processed.clear()
  }
}

/**
 * Simulate consumer: dedupe by event_id, then "handle" (count).
 */
export function consumeIdempotent(
  processedEvents: MockProcessedEvents,
  envelope: EventEnvelope,
  onHandled: () => void
): boolean {
  const inserted = processedEvents.tryInsert(envelope.event_id)
  if (!inserted) return false
  onHandled()
  return true
}
