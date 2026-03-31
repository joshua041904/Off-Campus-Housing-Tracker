# Issue 12 — Stabilize trust moderation & flagging workflow

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md) · **Related:** [10-prevent-duplicate-flags-trust.md](10-prevent-duplicate-flags-trust.md), [appendix-middleware-logging-trust.md](appendix-middleware-logging-trust.md)

## Why

End-to-end **flagging** must handle duplicates, invalid IDs, and **consistent errors** without corrupting moderation state.

## Scope

- `services/trust-service`
- `webapp` trust UI **only** if response fields change

## Rebuild matrix (from backlog)

| Scenario | Command |
|----------|---------|
| **trust-service only** | `pnpm run rebuild:service:trust` or `SERVICES=trust-service ./scripts/rebuild-och-images-and-rollout.sh` |
| **trust + webapp** | `SERVICES=trust-service ./scripts/rebuild-housing-colima.sh` (add other services if touched) |

## Files to touch

| File | Role |
|------|------|
| [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) | `POST /report-abuse`, peer-review error mapping (**23505** → 409), UUID validation |
| [`services/trust-service/src/grpc-server.ts`](../../services/trust-service/src/grpc-server.ts) | `ReportAbuse`, `FlagListing` — align codes/messages with HTTP |
| [`infra/db/01-trust-schema.sql`](../../infra/db/01-trust-schema.sql) | Constraints / comments for duplicate policy |
| [`webapp/app/trust/page.tsx`](../../webapp/app/trust/page.tsx) | Forms + success/error UI |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `reportAbuse` → `/api/trust/report-abuse` |

## Steps (implementation order)

1. **Duplicate flags** — implement policy (Issue 10).
2. **Invalid `target_id`** — validate UUID **before** Postgres; return **400** + stable JSON (**not** 500 `22P02`).
3. **Error shape** — align with Issue 7 (`{ data, error }` or agreed format).
4. **gRPC** — same semantics as HTTP for mobile/internal callers.

## Step 1 — Test matrix (manual)

| Case | Action |
|------|--------|
| Same item flagged twice | Expect idempotent response or **409** — per policy |
| Invalid target id | **400** + consistent body |
| Valid flag | **200** with `flag_id` / `status` |

Use curl as in [07](07-normalize-trust-response-format.md) and [10](10-prevent-duplicate-flags-trust.md).

## Step 2 — Webapp flow

1. Open `/trust`.
2. Submit report with valid listing UUID.
3. Submit duplicate — UI should show **clear** message (no generic crash).

## Success criteria

| Check | Expected |
|--------|-----------|
| Duplicates | No duplicate **state corruption** |
| Errors | Predictable status + JSON |
| UI | Handles new error types if API changed |

## Verification checklist

- [ ] Duplicate handling **idempotent/safe**.
- [ ] Invalid id → **400**, not **500**.
- [ ] HTTP + gRPC **aligned**.
- [ ] **Repro + fix notes** in GitHub issue.

## Done when

Repro + fix notes posted — per backlog.

## Rebuild hint

Trust + optional webapp per matrix above.
