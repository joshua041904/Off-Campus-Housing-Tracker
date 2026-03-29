# PR review notes: `fix/listings-validation-response-handling` vs `feature/system-build`

**Full deep review (hot-path cost, diagrams, DB protection, k6 tables):** [LISTINGS_VALIDATION_DEEP_REVIEW.md](./LISTINGS_VALIDATION_DEEP_REVIEW.md)

**Remote:** `origin/fix/listings-validation-response-handling`  
**Summary (author):** Centralized `validation.ts`; HTTP + gRPC use shared validation; create + listing ID + search filter (min/max price) validation; rejects bad IDs before DB; clearer 400s.

**Diff scope (listings-service):** `src/validation.ts` (new), `http-server.ts`, `grpc-server.ts`, removed `search-listings-query.ts` (logic inlined / replaced).

---

## 1. Does validation run synchronously on every request?

**Yes.** All validation is sync TypeScript: `validateListingId`, `validateCreateListingInput`, `validateSearchFilters` return `ValidationResult` objects. No `await` inside validation.

---

## 2. UUID validation — regex cost?

`isValidUuid` uses **one** RFC-style regex per call; `validateListingId` / `validateUserId` call it once per ID. **Acceptable** for hot path; not per-field repeated scans of the same string.

---

## 3. min_price / max_price — constant-time?

**Yes (practical).** `parseOptionalNonNegativeInteger` uses `Number()` + integer checks — O(1). Cross-check `min_price > max_price` is one comparison after parse.

---

## 4. Search filters parsed multiple times?

**No.** HTTP search path: **one** `validateSearchFilters({ min_price: req.query.min_price, max_price: req.query.max_price })` before building SQL. gRPC search (if present) should mirror — verify in full diff for any duplicate validation.

---

## 5. Exceptions vs structured errors?

Handlers check `validation.ok`; on failure return **400** (HTTP) or **INVALID_ARGUMENT** (gRPC) with **string message** — no stack-throw in steady path. Cheap.

---

## 6. HTTP + gRPC sharing the same validation?

**Yes — same module:** `import { validateCreateListingInput, validateListingId } from "./validation.js"` in both `http-server.ts` and `grpc-server.ts`. **Not** triple validation: api-gateway may still do its own routing/rate limits — that is separate; **service** layer is unified.

---

## 7. Order: validation vs auth vs DB

| Route | Order |
|-------|--------|
| GET `/listings/:id` | `validateListingId` → then `pool.query` |
| GET `/`, `/search` | `validateSearchFilters` → then SQL |
| POST `/create` | `requireUser` (x-user-id) → `validateCreateListingInput` → INSERT |
| gRPC CreateListing | `validateCreateListingInput` → then `pool.query` (user id from request body in gRPC) |

**Create (HTTP):** auth header first, then validation — good (reject unauthenticated before body validation cost if desired; currently both run for POST). Validation does **not** touch DB.

---

## 8. Risk checklist

| Risk | Assessment |
|------|------------|
| Regex-heavy validation | Single UUID regex; date check uses small regex + `Date` parse — fine |
| Large allocations | Create payload bounded by express `json({ limit: "1mb" })` — unchanged concern |
| DB inside validation | **None** |
| Double validation same field in one handler | **None** observed in HTTP search/get/create |
| Sync loops | `normalizeAmenities` maps array — size bounded by request |

---

## 9. What to run before merging (perf)

```bash
pnpm --filter listings-service build
SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-health.js
SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-concurrency.js
```

Compare p95 to **pre-PR** on same cluster. Small regression → profile `validation.ts` + handler only; large regression → check gateway / DB.

---

## 10. Branch strategy

- Review and k6 on **`fix/listings-validation-response-handling`** (or merge target).
- Keep **`feature/system-build`** perf experiments **rebased** after this PR merges, or use a dedicated **`perf/k6-baseline-*`** branch for Issue 9 logs so results stay comparable.
