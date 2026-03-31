# Issue 5 — Add Playwright test for listings flow

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Ensure **create listing → visible in UI / search** works end-to-end under TLS edge.

## Scope

`webapp/e2e`

## Existing files (extend or mirror)

| File | Role |
|------|------|
| [`webapp/e2e/listing-and-analytics-journey.spec.ts`](../../webapp/e2e/listing-and-analytics-journey.spec.ts) | Listing + analytics journey |
| [`webapp/e2e/listings-filters-maps.spec.ts`](../../webapp/e2e/listings-filters-maps.spec.ts) | Filters / maps |
| [`webapp/e2e/listings.full.spec.ts`](../../webapp/e2e/listings.full.spec.ts) | Full vertical |
| [`webapp/playwright.config.ts`](../../webapp/playwright.config.ts) | Project **03-listings** matches `listing-and-analytics-journey`, `listings-filters-maps` |
| [`webapp/app/listings/page.tsx`](../../webapp/app/listings/page.tsx) | `data-testid="listings-search-form"`, `listings-search-q`, filters |

## Step 1 — Local E2E (listings project)

```bash
cd "$(git rev-parse --show-toplevel)/webapp"
pnpm run test:e2e:03-listings
```

## Step 2 — Strict edge + integrity (optional CI parity)

```bash
pnpm run test:e2e:strict-verticals-and-integrity
```

## Step 3 — What the new/extended test should do

1. **Authenticate** (reuse patterns from `auth-cycle.spec.ts` / `flows.spec.ts` if needed).
2. Navigate to **`/listings`**.
3. **Create** listing via form (or API with page reload) — match production path.
4. **Assert** listing title (or id) appears in results or via search.

Use stable selectors: `data-testid` on form fields if missing (add in `page.tsx`).

## Success criteria

| Check | Expected |
|--------|-----------|
| Stability | No flake on timing — use `expect.poll` or wait for network idle where appropriate |
| CI | Test runs in project **03-listings** (or new project if you split) |
| Edge | `baseURL` from `playwright.config.ts` — HTTPS hostname |

## Debug matrix

| Symptom | Action |
|--------|--------|
| Timeout on create | Token missing; increase timeout; check gateway |
| Strict mode fails | `PLAYWRIGHT_STRICT_HTTP3` — see config |

## Verification checklist

- [ ] **Create** path covered (UI or API + UI verify).
- [ ] **Listing appears** in list or search results.
- [ ] **`pnpm run test:e2e:03-listings`** passes locally.
- [ ] CI workflow runs same command (check `.github/workflows`).

## Done when

Test merged and stable — per backlog.

## Rebuild hint

Usually **no** backend rebuild for test-only PR; if you add `data-testid` only **webapp** image.
