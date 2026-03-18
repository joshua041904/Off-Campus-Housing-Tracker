/**
 * Mocks for event-layer break tests. No real Kafka or Postgres.
 * Used to simulate: produce success/failure, commit/rollback, Kafka down.
 */

import type { OutboxRow, EventEnvelope } from './types.js'

/** In-memory outbox store. Update is staged until commit(); rollback = never call commit(). */
export class MockOutboxDb {
  private rows: Map<string, OutboxRow> = new Map()
  private stagedUpdates: Set<string> = new Set()

  insert(row: OutboxRow): void {
    this.rows.set(row.id, { ...row })
  }

  getUnpublished(limit: number): OutboxRow[] {
    const list = Array.from(this.rows.values())
      .filter((r) => !this.getEffectivePublished(r.id))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit)
    return list.map((r) => ({ ...r }))
  }

  private getEffectivePublished(id: string): boolean {
    const row = this.rows.get(id)
    if (!row) return false
    if (this.stagedUpdates.has(id)) return true
    return row.published
  }

  /** Stage UPDATE published = true for id. Only applied on commit(). */
  updatePublished(id: string): void {
    this.stagedUpdates.add(id)
  }

  /** Commit: apply staged updates to row.published. */
  commit(): void {
    for (const id of this.stagedUpdates) {
      const row = this.rows.get(id)
      if (row) row.published = true
    }
    this.stagedUpdates.clear()
  }

  /** Rollback: discard staged updates (simulate crash before commit). */
  rollback(): void {
    this.stagedUpdates.clear()
  }

  getRow(id: string): OutboxRow | undefined {
    const row = this.rows.get(id)
    return row ? { ...row } : undefined
  }

  isPublished(id: string): boolean {
    const row = this.rows.get(id)
    return row ? row.published : false
  }
}

/** Mock Kafka producer. Can be set to succeed or fail (Kafka down). */
export class MockProducer {
  private failNext = false
  private produced: EventEnvelope[] = []

  setFailNext(fail: boolean): void {
    this.failNext = fail
  }

  getProducedCount(): number {
    return this.produced.length
  }

  getProduced(): EventEnvelope[] {
    return this.produced.map((e) => ({ ...e, payload: Buffer.from(e.payload) }))
  }

  clearProduced(): void {
    this.produced = []
  }

  async send(_topic: string, key: string, envelope: EventEnvelope): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('Kafka unreachable')
    }
    this.produced.push({ ...envelope, payload: Buffer.from(envelope.payload) })
  }
}

/** Mock health check that uses MockProducer or a custom predicate (e.g. Kafka connectivity). */
export class MockKafkaHealthCheck {
  private up = true

  setUp(up: boolean): void {
    this.up = up
  }

  async check(): Promise<boolean> {
    return this.up
  }
}
