# Issue 11 — Fix listing search sort stability

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Same query run multiple times must return **identical order** and **no duplicate `id`** in one response. Unstable `ORDER BY` (ties on `created_at`) causes flicker; bad joins could duplicate rows (rare for current single-table search).

## Scope

`services/listings-service`

## Files to touch

| File | Role |
|------|------|
| [`services/listings-service/src/search-listings-query.ts`](../../services/listings-service/src/search-listings-query.ts) | `orderBy` branches (~L68–L71); append **`, id ASC`** or **`, id DESC`** as deterministic tie-breaker |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | No change if SQL is the only issue |
| [`services/listings-service/src/grpc-server.ts`](../../services/listings-service/src/grpc-server.ts) | Uses same query builder — verify |
| [`services/listings-service/tests/search-listings-query.test.ts`](../../services/listings-service/tests/search-listings-query.test.ts) | Assert final `ORDER BY` includes `id` |

## Current `ORDER BY` (reference)

| sort param | SQL fragment |
|------------|----------------|
| `created_desc` (default) | `created_at DESC` |
| `listed_desc` | `listed_at DESC NULLS LAST, created_at DESC` |
| `price_asc` | `price_cents ASC NULLS LAST, created_at DESC` |
| `price_desc` | `price_cents DESC NULLS LAST, created_at DESC` |

**Recommended fix:** append `, id ASC` to every branch (stable ascending UUID tie-break).

## Step 1 — Run same curl three times

```bash
URL="${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc"
for i in 1 2 3; do
  curl --http2 -sS --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "$URL" | jq -c '[.items[].id]'
done
```

**Success:** Three lines **byte-identical** (same id order).

## Step 2 — Duplicate ids in one response

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=price_asc" \
  | jq '[.items[].id] | group_by(.) | map(select(length>1)) | length'
```

**Success:** Output **`0`** (no duplicate ids).

## Step 3 — Playwright

```bash
cd "$(git rev-parse --show-toplevel)/webapp"
pnpm run test:e2e:03-listings
```

## Success criteria

| Check | Expected |
|--------|-----------|
| Repeatability | 3× same query → same order |
| Uniqueness | No duplicate ids in `items` |
| Pagination | Stable across pages when Issue 9 lands |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Order flickers | Missing secondary sort on `id` |
| Duplicates | DISTINCT / join bug (inspect SQL) |

## Verification checklist

- [ ] **Stable ordering** with tie-breaker.
- [ ] **No duplicate IDs** in JSON array.
- [ ] **curl** proof attached to issue.
- [ ] **listings** Playwright project passes.

## Done when

curl output shows stable ordering; listings Playwright passes — per backlog.

## Rebuild hint

`pnpm run rebuild:service:listings`
