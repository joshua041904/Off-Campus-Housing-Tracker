# Issue 10 — Prevent duplicate flags in trust-service

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Same user flagging the **same listing** twice should be **idempotent** (one stored row or explicit **409**) — not duplicate moderation rows unless product explicitly allows.

## Scope

`services/trust-service`

## Schema today

[`infra/db/01-trust-schema.sql`](../../infra/db/01-trust-schema.sql):

- `trust.listing_flags` — comment: **“one listing can be flagged multiple times”** — **no UNIQUE** on `(listing_id, reporter_id)` (~L31–L48).
- **Peer review** already maps **23505** → **409** `{ "error": "duplicate review" }` in [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) — **flag paths do not yet**.

## Files to touch

| File | Role |
|------|------|
| [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) | `POST /report-abuse` — INSERT listing_flags / user_flags (~L96+) |
| [`services/trust-service/src/grpc-server.ts`](../../services/trust-service/src/grpc-server.ts) | `ReportAbuse`, `FlagListing` — same rules |
| **Migration SQL** | Optional `UNIQUE (listing_id, reporter_id)` **or** application-level **SELECT** before insert |
| [`infra/db/01-trust-schema.sql`](../../infra/db/01-trust-schema.sql) | Document final intent after product decision |

## Product decision (record in issue)

Choose one:

1. **Unique constraint** + return **409** on conflict (like peer review).
2. **Idempotent OK**: second POST returns **200** with **same `flag_id`** (upsert / select existing).
3. **Allow duplicates**: close issue as WONTFIX — document why.

## Step 1 — Double POST test

```bash
TOKEN="<jwt>"
BODY='{"target_type":"listing","target_id":"<listing-uuid>","reason":"spam","description":"d"}'
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" \
  "${EDGE_BASE_HTTPS}/api/trust/report-abuse"
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" \
  "${EDGE_BASE_HTTPS}/api/trust/report-abuse"
```

**Success after fix:** Second response **409** or **200** with same id — per chosen rule; **not** two new pending rows if idempotent.

## Step 2 — DB verification

```sql
SELECT listing_id, reporter_id, count(*) FROM trust.listing_flags
GROUP BY 1, 2 HAVING count(*) > 1;
```

**Success:** No rows (if dedupe required).

## Success criteria

| Check | Expected |
|--------|-----------|
| Duplicate submit | One logical flag per (listing, reporter) |
| API | Consistent JSON + HTTP status |
| gRPC | Same semantics |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| 500 on duplicate | Uncaught unique violation — handle like peer review |
| 500 bad UUID | Postgres `22P02` — validate UUID before query |

## Verification checklist

- [ ] Same flag request **twice** → **one** stored row (or explicit policy).
- [ ] **409** or idempotent body **documented**.
- [ ] **gRPC** matches HTTP.
- [ ] **Migration** applied in dev/staging.

## Done when

Duplicate flags ignored or rejected per policy; behavior in GitHub issue — per backlog.

## Rebuild hint

`pnpm run rebuild:service:trust` + run DB migrations.
