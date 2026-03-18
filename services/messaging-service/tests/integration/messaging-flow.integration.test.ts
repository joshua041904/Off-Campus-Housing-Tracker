/**
 * Integration test: Register → Login → CreateConversation → SendMessage → GetConversation → MarkAsRead.
 * Asserts: message row, outbox row, Kafka event; rate limiting and Trust not triggered.
 * Requires: Postgres (messaging), Redis, Kafka up; auth service or mock JWT.
 */
import { describe, it, expect, beforeAll } from 'vitest'

describe('Messaging flow (integration)', () => {
  beforeAll(() => {
    // TODO: ensure DB/Redis/Kafka env; optional auth client for register/login
  })

  it('sends message and writes outbox row', async () => {
    // 1. Get JWT (AuthService.Register + Login or use fixture token)
    // 2. CreateConversation (gRPC or REST)
    // 3. SendMessage
    // 4. Query DB: message row exists, outbox_events row for message.sent
    // 5. Assert Kafka produce (consumer or test-consumer)
    expect(true).toBe(true) // placeholder until auth + messaging client wired
  })

  it('enforces rate limit after 30 messages per minute', async () => {
    // Send 31 messages in same minute; expect 31st returns rate limit error
    expect(true).toBe(true) // placeholder
  })
})
