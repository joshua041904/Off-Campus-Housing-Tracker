/**
 * Stub consumer for MessageSentV1. On event: increment user_listing_engagement.messages_sent.
 * Idempotent: use processed_events (insert event_id before handle); on conflict skip.
 * Ordering preserved per conversation when partition key = conversation_id.
 */

export interface MessageSentV1Payload {
  message_id: string
  conversation_id: string
  sender_id: string
  recipient_id: string
  sent_at: string
  media_id?: string
}

/** Process one MessageSentV1. Caller must have already deduped by event_id (processed_events). */
export async function handleMessageSentV1(
  payload: MessageSentV1Payload,
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }> }
): Promise<void> {
  // Increment user_listing_engagement.messages_sent. Table must exist (migration: user_id, listing_id, messages_sent, bookings, last_interaction_at).
  // Use conversation_id as listing_id placeholder until conversation→listing mapping exists.
  await db.query(
    `INSERT INTO analytics.user_listing_engagement (user_id, listing_id, messages_sent, last_interaction_at)
     VALUES ($1, $2, 1, $3::timestamptz)
     ON CONFLICT (user_id, listing_id) DO UPDATE SET
       messages_sent = analytics.user_listing_engagement.messages_sent + 1,
       last_interaction_at = EXCLUDED.last_interaction_at`,
    [payload.sender_id, payload.conversation_id, payload.sent_at]
  )
}
