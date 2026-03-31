# Issue 1 — Fix listings loading state never resolving

**Owner:** Joshua · **Plain-text:** [`Github_issues copy.txt`](../../Github_issues%20copy.txt) (first block) · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Async + state + API timing: the UI can stay in a loading state (`aria-busy=true`) or never show results when search / initial load races or errors are swallowed.

## Scope

- `webapp` — React state around `searchListings`
- `listings-service` — slow or failing `GET /search` or `GET /`

## Files to touch (primary)

| File | Role |
|------|------|
| [`webapp/app/listings/page.tsx`](../../webapp/app/listings/page.tsx) | `loading` state; `useEffect` initial `searchListings({})`; `onSearch` `finally { setLoading(false) }`; `aria-busy={loading}` on results region (~L345) |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `searchListings` → `GET /api/listings/search` |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | `searchListingsPublic` handler; errors → 500 JSON |
| [`services/listings-service/src/search-listings-query.ts`](../../services/listings-service/src/search-listings-query.ts) | Query build (unlikely for “stuck loading” unless query hangs) |

## Step 0 — Environment

See hub [`Step 0`](../JOSHUA_ISSUES_PLAYBOOK.md#step-0--environment-curl-against-edge).

## Step 1 — Reproduce with curl (isolates backend)

```bash
curl --http2 -sS -w "\nhttp_code=%{http_code} time_total=%{time_total}\n" \
  --cacert "$CA_CERT" --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search"
```

**Success:** `http_code=200` and JSON `items` in reasonable `time_total`.

## Step 2 — Browser / Playwright

1. Open `https://off-campus-housing.test/listings` (certs trusted).
2. Observe **initial load**: loading indicator should clear; **aria-busy** should become `false` on the results container.
3. Submit search form — same expectation.

### Playwright projects that hit listings

```bash
cd "$(git rev-parse --show-toplevel)/webapp"
pnpm run test:e2e:03-listings
```

## Success criteria

| Check | Expected |
|--------|-----------|
| Initial mount | `loading` → `false` after fetch settles (success or error) |
| `aria-busy` | `false` when not fetching |
| Error path | User-visible error; not infinite spinner |
| Network slow | Optional: abort/timeout behavior if you add it |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Stuck true after error | Missing `finally` / wrong branch without `setLoading(false)` |
| Flash then empty | `setItems([])` on catch — check `setErr` |
| Only first load stuck | `useEffect` cancel vs `loading` |
| 502 from edge | listings pod / gateway |

## Verification checklist

- [ ] **aria-busy=false** when idle after load and after search.
- [ ] **Results render** when API returns items.
- [ ] **Error message** when API fails (no infinite loading).
- [ ] `pnpm run test:e2e:03-listings` passes if you change selectors/behavior.

## Done when

`aria-busy=false` and results (or clear error) after load/search — per backlog text.

## Rebuild hint

Webapp-only UI fix: rebuild webapp image / colima as your team does. If you change **listings-service**: `pnpm run rebuild:service:listings`.
