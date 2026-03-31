# Issue 9 — Add pagination to listings API

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Search currently caps at **50 rows** hard-coded. Product needs **`limit`** and **`offset`** (or cursor) for paging.

## Scope

`services/listings-service` (+ gateway is pass-through for query string)

## Current behavior (before change)

[`services/listings-service/src/search-listings-query.ts`](../../services/listings-service/src/search-listings-query.ts) ends with:

```sql
ORDER BY ${orderBy}
LIMIT 50
```

HTTP handler: [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) `searchListingsPublic` — reads `min_price`, `max_price`, `sort`, etc., but **no** `limit`/`offset` today.

## Files to touch

| File | Role |
|------|------|
| [`services/listings-service/src/search-listings-query.ts`](../../services/listings-service/src/search-listings-query.ts) | Add `limit` / `offset` (or `cursor`) to `ListingsSearchFilters` and SQL with **safe caps** (e.g. max limit 100) |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | Parse `req.query.limit`, `req.query.offset` (integers), pass to builder |
| [`services/listings-service/src/grpc-server.ts`](../../services/listings-service/src/grpc-server.ts) | Mirror pagination fields on `SearchListings` RPC if proto defines them |
| Proto (if gRPC) | `proto/` listings definitions — regenerate TS if needed |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `searchListings()` — pass through `limit` / `offset` query params |
| [`services/listings-service/tests/search-listings-query.test.ts`](../../services/listings-service/tests/search-listings-query.test.ts) | Assert LIMIT/OFFSET in SQL |
| [`webapp/app/listings/page.tsx`](../../webapp/app/listings/page.tsx) | Optional: “Load more” UI |

## Step 1 — curl: first page (after implementation)

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?limit=10&offset=0&sort=created_desc"
```

**Success:** `items.length <= 10`.

## Step 2 — curl: second page

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?limit=10&offset=10&sort=created_desc"
```

**Success:** Results **differ** from page 1 (unless ≤10 total listings); **stable order** with Issue 11 tie-break if needed.

## Step 3 — Abuse / bounds

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?limit=99999&offset=0"
```

**Success:** Server **clamps** to max or returns **400** — document choice.

## Success criteria

| Check | Expected |
|--------|-----------|
| `limit=10` | At most 10 items |
| `offset` | Shifts window |
| Order | Same `sort` as non-paginated |
| Total count | Optional `total` field — only if product asks (may require `COUNT(*)` query) |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Duplicate rows across pages | Unstable `ORDER BY` — add `id` tie-break (see Issue 11) |
| Slow OFFSET | Large offset on huge tables — consider keyset pagination later |

## Verification checklist

- [ ] **limit** and **offset** work via **curl** on edge URL.
- [ ] **gRPC** aligned if exposed.
- [ ] **Tests** for SQL builder + HTTP parsing.
- [ ] **Max limit** enforced.

## Done when

Pagination works via curl — per backlog.

## Rebuild hint

`pnpm run rebuild:service:listings`
