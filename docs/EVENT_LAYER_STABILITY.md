# Event layer stability — freeze after verification

This document locks the event backbone as **production-grade and correct**. Do not add stronger guarantees (Kafka transactions, exactly-once producer, saga orchestrators) without an explicit architecture decision. This is the intended equilibrium.

---

## Critical ordering (outbox publisher)

The **only** correct order:

1. **Produce to Kafka** (await success).
2. **If success** → `UPDATE outbox_events SET published = true WHERE id = row.id`.
3. **Commit the DB transaction.**

**Forbidden:**

- ❌ Mark published before publish.
- ❌ Commit the update before produce success.
- ❌ Publish outside the retry loop.
- ❌ On produce failure → must leave `published = false` (next poll retries).

**Why:** If you mark published before produce, and produce then fails, the event is lost forever. Idempotent consumers make duplicate-on-retry safe; loss is not.

Ref: docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md, docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md.

---

## Failure cases (why this order is correct)

| Case | What happens | Result |
|------|----------------|--------|
| Produce fails | No update, no commit | Row stays `published = false`; next poll retries. Correct. |
| Produce succeeds, DB update/commit fails | Kafka has message; row still `published = false` | Next poll republishes → duplicate. Idempotent consumers dedupe. Correct tradeoff (at-least-once over event loss). |
| Update before produce (forbidden) | `published = true`, then produce fails | Event lost forever. Docs explicitly forbid this. |

---

## What this design guarantees

- No lost events (no mark-before-publish).
- At-least-once delivery (Kafka + retry).
- Idempotent consumption (processed_events; duplicate = safe).
- Deterministic retry (same row retried until produce + update succeed).
- No publish-before-commit race (domain write + outbox insert in one transaction).
- No commit-before-produce race (update only after produce success).

There is no stronger guarantee without Kafka transactions / 2PC / much higher complexity. This is the correct complexity level for this scale.

---

## Do NOT add (without explicit decision)

- Kafka transactions.
- Exactly-once producer mode.
- Saga orchestrators.
- Cross-domain choreography.
- Message compaction tuning (until needed).
- Schema registry (until needed).
- Event choreography engines.

Consider the event layer **frozen** after verification. Changes should be limited to operational tuning (retries, DLQ, monitoring), not to the ordering or semantics above.

---

## Verification before freeze

Design does not freeze the layer. **Verification** does. Run these in order:

1. **Implement** publisher worker and consumer wiring per docs.
2. **Run** with real DB and Kafka.
3. **Test** happy path (publish → update → commit; consume → insert processed_events → handle).
4. **Break it intentionally** — run these three tests exactly:

   **Test 1 — Kill after produce**  
   Inject crash right after Kafka produce success, before `UPDATE published = true`. Restart service.  
   **Expected:** Row still `published = false`. Next poll republishes. Consumer idempotency absorbs duplicate. If that works → ordering is correct.

   **Test 2 — Kill after UPDATE but before commit**  
   Simulate transaction rollback (crash after UPDATE, before commit).  
   **Expected:** Row still `published = false`. Retry works; no event loss.

   **Test 3 — Kafka down**  
   Take Kafka offline (or unreachable).  
   **Expected:** Publish fails; `published` remains false. Health flips to NOT_SERVING if Kafka is required. When Kafka returns, retries succeed.

5. If all three pass → event layer is battle-tested. **Freeze** this layer. Do not touch ordering, add extra layers, transactions, or "clever" features. Further complexity now decreases reliability.

After freeze, shift focus to search/filtering, recommendation engine, UX, observability—not event-layer tweaking.
