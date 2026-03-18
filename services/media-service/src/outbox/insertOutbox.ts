import { pool } from '../db/mediaRepo.js'

/** Insert outbox row for MediaUploadedV1. Payload must be serialized proto bytes. aggregate_id = media_id for Kafka key. */
export async function insertOutbox(
  aggregateId: string,
  type: string,
  version: number,
  payload: Buffer,
  client?: import('pg').PoolClient
): Promise<void> {
  const q = client || pool
  await q.query(
    `INSERT INTO media.outbox_events (aggregate_id, type, version, payload) VALUES ($1, $2, $3, $4)`,
    [aggregateId, type, version, payload]
  )
}
