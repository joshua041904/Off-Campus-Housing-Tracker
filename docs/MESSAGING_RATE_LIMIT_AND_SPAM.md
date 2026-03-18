# Messaging rate limiting, spam detection, and recommendation signals

Messaging is abuse-prone. This doc locks: rate limiting (Redis), spam detection (Trust consumer), and recommendation read model (Analytics consumer). No Kafka for rate limiting; no cross-service DB access.

---

## 1. Rate limiting (Redis)

**Do NOT use Kafka for rate limiting.** Use Redis.

**Key:** `rate:msg:{user_id}`

**Mechanism:**

- **INCR** on each SendMessage (per user_id).
- **EXPIRE** 60 seconds (sliding or fixed window; 60s window is simple).
- Optional: second key for daily cap, e.g. `rate:msg:day:{user_id}` with TTL 86400.

**Rules (example):**

- Max **30 messages per minute** per user.
- Max **500 per day** per user (optional).

If exceeded → gRPC error (e.g. `RESOURCE_EXHAUSTED` or `PERMISSION_DENIED` with message "Rate limit exceeded"). Messaging service checks Redis **before** inserting message and outbox.

**Alternative (DB-backed sliding window):** Table `messaging.message_rate_limit (user_id, window_start, count)` — see **infra/db/05-messaging-rate-limit.sql**. Use when Redis is not available. Periodic cleanup of old windows required. Prefer Redis for speed and simplicity.

---

## 2. Spam detection (Trust service)

**Trust service consumes** MessageSentV1 from `${ENV_PREFIX}.messaging.events`. Messaging service does **not** consume its own topic.

**Lightweight detection rules (first version):**

- X messages to **different users** in Y minutes (e.g. 10 recipients in 5 min).
- **Same message content** sent to many recipients.
- **Message frequency anomaly** (e.g. burst far above user baseline).
- **User reports** (existing user_flags / listing_flags; can feed into score).

**Storage:** Trust DB table **trust.user_spam_score** (user_id, score, updated_at). Trust updates score when processing MessageSentV1; on threshold exceeded → emit **UserSuspendedV1**. Auth/listings/booking/messaging consume suspension and reject or restrict.

**Flow:**

- Trust consumes MessageSentV1 → applies rules → update user_spam_score.
- If score ≥ threshold → insert into user_suspensions (or equivalent), emit UserSuspendedV1.
- **Messaging service** rejects SendMessage for suspended users (call Trust or Auth gRPC to check, or consume user.suspended and cache).

**No cross-service DB access.** Trust owns suspension and score; others enforce via gRPC or events.

---

## 3. Recommendation engine from messaging engagement

**Analytics service consumes:**

- MessageSentV1
- BookingCreatedV1
- ListingViewed (if added later)

**Read model (example):**

**user_listing_engagement**

- user_id
- listing_id
- messages_sent
- bookings (count or flag)
- last_interaction_at

**Signals:**

- High message volume → strong interest
- Fast landlord reply → boost listing
- High response rate → boost landlord rank
- Booking completion → strong positive signal

**Recommendation inputs (computed asynchronously in Analytics):**

- **Tenant side:** Listings similar to ones they messaged; listings near previous bookings; similar price range.
- **Landlord side:** Tenants with high completion rate; tenants with strong engagement patterns.

Messaging is **event source only**. No recommendation logic in messaging service.

---

## 4. Summary

| Concern | Where | How |
|--------|--------|-----|
| Rate limit | Messaging + Redis | Redis key rate:msg:{user_id}, INCR, EXPIRE 60s; max 30/min, 500/day |
| Spam score | Trust | Consume MessageSentV1; user_spam_score; emit UserSuspendedV1 on threshold |
| Suspension enforcement | Messaging (and others) | Reject SendMessage for suspended users (gRPC check or event) |
| Recommendation | Analytics | Consume MessageSentV1 + booking + views; build user_listing_engagement; rank listings/tenants |

Refs: [MESSAGING_KAFKA_ARCHITECTURE.md](MESSAGING_KAFKA_ARCHITECTURE.md), [MEDIA_SERVICE_DESIGN.md](MEDIA_SERVICE_DESIGN.md).
