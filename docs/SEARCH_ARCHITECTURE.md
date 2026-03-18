# Search Architecture — Postgres Now, Event-Fed Index Later

Strategy for listing search: **Phase 1** Postgres-only (current), **Phase 2** optional event-fed search index (Elastic/OpenSearch) without coupling to the listing write path.

---

## Phase 1 (current): Postgres only

**Stack:** pg_trgm, GIN index on `search_norm`, similarity(), no separate search service.

**Pros:**
- No extra infrastructure.
- Transactional consistency with listings DB.
- Good enough for &lt;100k listings.

**Implementation (listings DB):**
- `search_norm` column (normalized text from title, description, amenities).
- GIN index on `search_norm` using pg_trgm (`gist_trgm_ops` or `gin_trgm_ops`).
- Query pattern:

```sql
SELECT *
FROM listings.listings
WHERE status = 'active'
  AND deleted_at IS NULL
  AND search_norm % 'campus apartment'
ORDER BY similarity(search_norm, 'campus apartment') DESC
LIMIT 20;
```

**Files:** `infra/db/01-listings-schema-and-tuning.sql`, `02-listings-pgbench-trigram-knn.sql`.

---

## Phase 2 (future): Event-fed search index

When listings scale (e.g. &gt;1M) or full-text/geo needs exceed Postgres:

- Introduce **Elasticsearch** or **OpenSearch** as a dedicated search index.
- **Feed index via Kafka only.** Listing service emits:
  - `listing.created`
  - `listing.updated`
  - `listing.deleted` (or soft-delete event)
- A **search-indexer** service consumes these events and updates the search cluster.
- Listing service **does not** call the search service on write; no sync coupling.
- Read path: API gateway or listing service queries search cluster for search; by-id can stay on Postgres or search.

**Benefits:**
- Write path stays simple and fast.
- Search index can have different schema (analyzers, geo, facets).
- Rebuild index by replaying events.

**Resume line:** *Designed search abstraction to support eventual transition from Postgres trigram search to event-fed search indexing without coupling to the listing write path.*
