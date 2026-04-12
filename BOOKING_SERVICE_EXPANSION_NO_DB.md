# Booking service expansion ideas (no database schema changes)

Ways to grow **booking-service** behavior using **API design**, **composition**, **caching**, and **events**—without new migrations or tables.

## 1. Read-model aggregation (gateway or BFF)

- Add **gateway routes** that join **existing** booking responses with **listings-service** (or **trust-service**) data already exposed over gRPC/HTTP.
- Keeps booking DB bounded; latency trades for fewer round-trips from the webapp.

## 2. Redis / in-memory overlays (ephemeral state)

- **Soft holds**: short-TTL keys (`booking:hold:{listingId}:{userId}`) for “someone is checking out” UX—no Postgres row until confirm.
- **Idempotency**: store `Idempotency-Key → booking_id` in Redis to make **create** safe under retries (TTL aligned with client timeout).
- **Rate limits**: token bucket per user/listing using existing Redis patterns elsewhere in the stack.

## 3. Richer gRPC/HTTP without new columns

- **New RPCs** that filter/sort **existing** rows (e.g. “my upcoming”, “cancelled last 30d”) using current indexes.
- **Field masks** or optional `include_*` flags in the proto to return computed strings (status labels, formatted windows) from the same row.

## 4. Validation-only endpoints

- **Dry-run create**: validate dates, overlap rules, and listing policy **without** inserting (or use a transaction rolled back in tests only—still no schema change).
- **Quote / estimate**: return price breakdown from **in-code** rules + listing snapshot already on the booking payload.

## 5. Eventing (Kafka) without new tables

- Emit **richer CloudEvents** (or protobuf envelope) on **existing** lifecycle transitions: `BookingCreated`, `Confirmed`, `Cancelled`.
- Downstream **analytics** or **notifications** consume new fields in the **payload** only; outbox row can remain the same shape if it stores opaque payload bytes.

## 6. Policy engine in code

- Centralize **eligibility** (min notice, max stay, blackout windows) in a **pure module** tested with Vitest; booking-service calls it before write.
- Swap rules via **config map** / env JSON—no DDL.

## 7. External calendar / ICS (optional)

- Generate **ICS** or feed links from **existing** booking rows (read-only export); no persistence of calendar IDs required initially.

## 8. Observability and SLO hooks

- Add **RED metrics** histograms for `CreateBooking`, `Confirm` (latency, success rate).
- **Trace attributes**: `listing_id`, `tenant_id` on spans—debug cross-service without DB.

## 9. Compatibility shims

- **Versioned protos** (`v2` package) with deprecated fields kept optional—deploy gateway + service together; DB unchanged.

---

**When you truly need DDL:** long-lived audit history, dispute resolution state, or multi-step workflows that must survive Redis loss—plan a migration; until then, the above keeps product iteration unblocked.
