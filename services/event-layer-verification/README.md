# Event-layer verification tests

**Purpose:** Encode the three intentional break tests from [docs/EVENT_LAYER_STABILITY.md](../../docs/EVENT_LAYER_STABILITY.md) as automated tests. The event layer is frozen only after these pass.

**What is tested:**

1. **Test 1 — Kill after produce**  
   Crash injected after Kafka produce success, before `UPDATE published = true`.  
   Assert: row stays `published = false`; on “restart” the row is republished; consumer idempotency dedupes the duplicate.

2. **Test 2 — Kill after UPDATE but before commit**  
   Simulate transaction rollback (crash after UPDATE, before commit).  
   Assert: row stays `published = false`; retry run updates and commits successfully.

3. **Test 3 — Kafka down**  
   Producer fails (Kafka unreachable).  
   Assert: `published` remains false; health check returns false; when Kafka is back, retry succeeds.

**Run:**

```bash
pnpm test
```

Uses in-memory mocks (no real Kafka or Postgres). Real integration runs can use the same ordering and hooks against live infra.

**References:** [EVENT_LAYER_STABILITY.md](../../docs/EVENT_LAYER_STABILITY.md), [OUTBOX_PUBLISHER_IMPLEMENTATION.md](../../docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md), [ARCHITECTURE_RULES.md](../../ARCHITECTURE_RULES.md) Rule 9.
