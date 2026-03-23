# Listings: real SQL for browse/search (GET /api/listings)

`listings-service` builds **one dynamic SQL** for public browse. The gateway maps:

| Edge URL | Upstream (listings HTTP :4012) |
|----------|--------------------------------|
| `GET /api/listings` | `GET /` |
| `GET /api/listings/search?...` | `GET /search?...` |

Implementation: `services/listings-service/src/http-server.ts` → `searchListingsPublic`  
(same predicate logic as gRPC `SearchListings` in `services/listings-service/src/grpc-server.ts`.)

## Exact query shape (parameterized)

`WHERE` clauses (all `AND`):

1. `status::text = 'active'`
2. `(deleted_at IS NULL)`
3. Optional: `(title ILIKE $n OR description ILIKE $n)` when `q` is non-empty — **same bind** for both sides (`%...%` with `%` / `_` escaped in the string).
4. Optional: `price_cents >= $n`, `price_cents <= $n`
5. Optional: `smoke_free = true` if `smoke_free=1|true`
6. Optional: `pet_friendly = true` if `pet_friendly=1|true`

Then:

```sql
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE <predicates above>
ORDER BY created_at DESC
LIMIT 50;
```

## Concrete examples for `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`

**A — No search query (browse only)** — smallest predicate set:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active'
  AND (deleted_at IS NULL)
ORDER BY created_at DESC
LIMIT 50;
```

**B — k6-style text search** (matches `k6-listings.js`: `GET /api/listings/search?q=k6-1-0&smoke_free=0`):

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active'
  AND (deleted_at IS NULL)
  AND (title ILIKE $1 OR description ILIKE $1)
ORDER BY created_at DESC
LIMIT 50;
```

Use: `\set q '%k6-1-0%'` then `$1` bound to `:'q'` in `psql`, or pass the literal once:

```sql
-- example bind
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active'
  AND (deleted_at IS NULL)
  AND (title ILIKE '%k6-1-0%' OR description ILIKE '%k6-1-0%')
ORDER BY created_at DESC
LIMIT 50;
```

## Run against local listings DB (default port 5442)

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f path/to/explain.sql
```

Or use the helper: `scripts/perf/explain-listings-search.sh`

## Important: existing index vs current query

`infra/db/01-listings-schema-and-tuning.sql` already defines:

- `search_norm` maintained by trigger from `title` + `description`
- **GIN** index: `idx_listings_search_norm_gin ON listings.listings USING gin (search_norm gin_trgm_ops)`

The application **does not** query `search_norm` today; it uses **`title ILIKE … OR description ILIKE …`**, so the trigram GIN on `search_norm` may **not** be used. After you capture `EXPLAIN`, compare:

- Seq Scan / Bitmap Heap Scan on large row counts vs
- Possible **Index Scan** if the query is rewritten to use `search_norm` (e.g. `search_norm ILIKE $1`) with the same `%…%` pattern.

**Do not add arbitrary composite indexes until the plan confirms the bottleneck.** (User request: indexes only after reviewing the plan.)

## Ramp load (saturation curve)

After tuning:

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" \
  k6 run scripts/load/k6-listings-ramp.js
```

See `scripts/load/k6-listings-ramp.js` (arrival-rate ramp, no strict SLO thresholds — metrics only).
