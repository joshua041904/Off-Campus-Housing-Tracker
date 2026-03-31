# Joshua — Listings, trust, media & webapp playbook

**Owner:** Joshua  

This is the **hub** for [`Github_issues copy.txt`](../Github_issues%20copy.txt). Each GitHub-scale issue has its **own Markdown file** under [`docs/joshua/`](joshua/) with commands, file paths, success/debug tables, and checklists.

**Related:** [Engineering Validation Spec v2](../Github_issues.txt) · [Franco search/UI](FRANCO_SEARCH_UI_VALIDATION.md) · [Arkar platform/auth/analytics](ARKAR_ISSUES_PLAYBOOK.md) (different backlog tracks).

---

## How to use

1. Open the **per-issue doc** below for the ticket you are implementing.
2. Run **Step 0** once per shell when using `curl` against the edge.
3. After code changes, use the **rebuild matrix** in the relevant issue (listings, trust, media, webapp).

---

## Table of contents — per-issue docs

| # | Issue | Doc |
|---|--------|-----|
| 1 | Fix listings loading state never resolving | [01-fix-listings-loading-state.md](joshua/01-fix-listings-loading-state.md) |
| 2 | Fix listing creation confirmation UI | [02-fix-listing-creation-confirmation-ui.md](joshua/02-fix-listing-creation-confirmation-ui.md) |
| 3 | Fix pet-friendly filter indexing | [03-fix-pet-friendly-filter-indexing.md](joshua/03-fix-pet-friendly-filter-indexing.md) |
| 4 | Fix listing detail fetch by ID | [04-fix-listing-detail-fetch-by-id.md](joshua/04-fix-listing-detail-fetch-by-id.md) |
| 5 | Add Playwright test for listings flow | [05-playwright-listings-flow.md](joshua/05-playwright-listings-flow.md) |
| 6 | Store metadata for uploaded media | [06-store-media-upload-metadata.md](joshua/06-store-media-upload-metadata.md) |
| 7 | Normalize trust-service response format | [07-normalize-trust-response-format.md](joshua/07-normalize-trust-response-format.md) |
| 8 | Validate listing creation input | [08-validate-listing-creation-input.md](joshua/08-validate-listing-creation-input.md) |
| 9 | Add pagination to listings API | [09-add-listings-pagination-api.md](joshua/09-add-listings-pagination-api.md) |
| 10 | Prevent duplicate flags in trust-service | [10-prevent-duplicate-flags-trust.md](joshua/10-prevent-duplicate-flags-trust.md) |
| 11 | Fix listing search sort stability | [11-fix-listing-search-sort-stability.md](joshua/11-fix-listing-search-sort-stability.md) |
| 12 | Stabilize trust moderation & flagging | [12-stabilize-trust-moderation-flagging.md](joshua/12-stabilize-trust-moderation-flagging.md) |
| — | Appendix: middleware / logging (trust) | [appendix-middleware-logging-trust.md](joshua/appendix-middleware-logging-trust.md) |

---

## Overview — request paths

```text
Browser / Playwright
  → edge (Caddy TLS, off-campus-housing.test)
  → api-gateway (OPEN_ROUTES for public GET listings search + GET .../listings/:id)
  → listings-service HTTP :4012  (upstream paths /, /search, /listings/:id, POST /create)

Trust / media
  → gateway /api/trust/* , /api/media/* → respective services
```

---

## Step 0 — Environment (curl against edge)

From **repo root**:

```bash
cd "$(git rev-parse --show-toplevel)"

export EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
export EDGE_PORT="${EDGE_PORT:-443}"
export CA_CERT="${CA_CERT:-$PWD/certs/dev-root.pem}"
export OCH_EDGE_IP="${OCH_EDGE_IP:-192.168.64.240}"   # your LB / ingress IP
export EDGE_BASE_HTTPS="https://${EDGE_HOST}"
```

Use on every edge `curl`:

```bash
--cacert "$CA_CERT" --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}"
```

### Step 0 checklist

- [ ] `test -s "$CA_CERT"` or run `./scripts/dev-generate-certs.sh`
- [ ] `OCH_EDGE_IP` matches this cluster
- [ ] Optional: `/etc/hosts` has `$OCH_EDGE_IP $EDGE_HOST` for browsers

---

## Step 0a — Quick sanity (listings + gateway)

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**Success:** `HTTP/2` and **200**.

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc"
```

**Success:** **200** JSON with `"items"` array.

---

## Shared contract — listings search (Joshua issues touch this often)

| Item | Detail |
|------|--------|
| **Gateway URL** | `GET ${EDGE_BASE_HTTPS}/api/listings/search?...` |
| **Upstream** | Gateway strips `/api/listings` → listings-service `GET /search` |
| **Prices** | `min_price`, `max_price` are **integer cents** |
| **Pet filter** | `pet_friendly=1` or `true` |
| **Sort** | `created_desc` (default), `listed_desc`, `price_asc`, `price_desc` — see `SEARCH_SORTS` in `search-listings-query.ts` |
| **Hard limit today** | `LIMIT 50` in `buildListingsSearchQuery()` — pagination issue replaces/extends this |

**Implementation files**

- `services/listings-service/src/http-server.ts` — wires query params → `buildListingsSearchQuery`
- `services/listings-service/src/search-listings-query.ts` — SQL + `ORDER BY`
- `services/listings-service/src/grpc-server.ts` — gRPC search (keep filters in sync)
- `webapp/lib/api.ts` — `searchListings()`, `getListing()`, `createListing()`
- `webapp/app/listings/page.tsx` — UI state, `aria-busy`, create flow
- `services/api-gateway/src/server.ts` — `OPEN_ROUTES` patterns for listings

---

## Rebuild matrix (shared)

| Changed | Command |
|---------|---------|
| **listings-service only** | `pnpm run rebuild:service:listings` or `SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh` |
| **trust-service only** | `pnpm run rebuild:service:trust` |
| **media-service only** | `pnpm run rebuild:service:media` |
| **webapp + default backends** | `./scripts/rebuild-housing-colima.sh` or `pnpm run rebuild:housing:colima` |
| **webapp + trust** | e.g. `SERVICES=trust-service ./scripts/rebuild-housing-colima.sh` (add other `SERVICES=` if touched) |
| **gateway** | Include `api-gateway` in `SERVICES=` for `rebuild-och-images-and-rollout.sh` / colima script as appropriate |

---

## Global debug — listings / trust

| Symptom | Where |
|---------|--------|
| 401 on public GET listing | `OPEN_ROUTES` in `services/api-gateway/src/server.ts` |
| 404 detail | Gateway path rewrite vs upstream `/listings/:id`; row deleted |
| 400 bad UUID | `validateListingId` in `services/listings-service/src/validation.ts` |
| Search empty with filters | `search-listings-query.ts` WHERE clause; DB data |
| Trust 500 on bad UUID | Validate before Postgres (`22P02`) — see trust `http-server.ts` |

---

*Plain-text backlog: [`Github_issues copy.txt`](../Github_issues%20copy.txt).*
