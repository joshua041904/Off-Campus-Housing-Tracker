# PR draft: Listings perf workflow, k6 Phase B, tail-latency orchestration

**Suggested title:** `docs(perf): listings validation review playbook, k6 concurrency/malformed/dual probes, preflight k6 orchestration defaults`

**Base branch:** `main` — open PRs against `main` (integration work from the former `feature/system-build` line is merged).

---

## Summary

This change adds a **disciplined Phase A → B → C** performance workflow for Issues 9/10, a **deep written review** of teammate branch `fix/listings-validation-response-handling`, and **k6 scripts** for per-service concurrency, malformed-input abuse, and dual-service gateway contention. It also tightens **load-lab orchestration** (gateway drain order, post-drain sleep, optional k6 kill) in `run-housing-k6-edge-smoke.sh` / `k6-suite-resource-hooks.sh`, exports **`_preflight_export_k6_orchestration_defaults`** in `run-preflight-scale-and-all-suites.sh`, hardens **HTTP/3 listings** curl timeouts, and updates **GitHub issue** text for rebuild matrices.

**No merge of** `fix/listings-validation-response-handling` **into this branch** — review docs reference that PR for the author to merge separately.

---

## Key files

| Area | Files |
|------|--------|
| Phase order + commands | `docs/perf/PERF_EXECUTION_ORDER_PHASES_A_B_C.md` |
| Deep PR audit | `docs/perf/LISTINGS_VALIDATION_DEEP_REVIEW.md` |
| Short checklist | `docs/perf/LISTINGS_VALIDATION_PR_REVIEW_fix-listings-validation.md` |
| k6 | `scripts/load/k6-listings-concurrency.js`, `k6-messaging-concurrency.js`, `k6-analytics-concurrency.js`, `k6-booking-concurrency.js`, `k6-listings-malformed.js`, `scripts/perf/k6-dual-service-contention.js` |
| Orchestration | `scripts/lib/k6-suite-resource-hooks.sh`, `scripts/run-housing-k6-edge-smoke.sh`, `scripts/run-preflight-scale-and-all-suites.sh` |
| Listings H3 test | `scripts/test-listings-http2-http3.sh` |
| Issues | `GITHUB_ISSUES_EXECUTABLE.txt` |
| Shortcuts | Root `package.json` `k6:*` scripts |

---

## Verification performed (this machine)

### Builds

- `pnpm --filter listings-service build` on **`main`**: **pass**
- Isolated **`git worktree`** on **`origin/fix/listings-validation-response-handling`** (`pnpm install` + `pnpm --filter listings-service build`): **pass** (worktree removed after)

### k6 (edge `https://off-campus-housing.test`, `SSL_CERT_FILE=certs/dev-root.pem`)

Full log: `bench_logs/perf-phase-b-k6-20260324-151811.log`

| Script | med | p(95) | p(99) | max | http_reqs/s |
|--------|-----|-------|-------|-----|-------------|
| `k6-listings-health.js` (25s, 4 VUs) | 12.89 ms | 56.61 ms | 167.15 ms | 351.64 ms | ~56.1 |
| `k6-listings-concurrency.js` (full ~40s ramp) | 18.3 ms | 120.53 ms | 319.57 ms | 2.68 s | ~72.2 |
| `k6-listings-malformed.js` (30s) | 19.32 ms | 173.86 ms | — | 609.36 ms | ~11.0 |
| `k6-dual-service-contention.js` `DUAL_PAIR=messaging+listings` | 15.25 ms | 101.4 ms | 290.22 ms | 877.96 ms | ~78.7 |
| `k6-dual-service-contention.js` `DUAL_PAIR=analytics+listings` | 19.22 ms | 132.64 ms | 311.94 ms | 1.02 s | ~73.3 |

**Malformed script:** Thresholds pass. Checks **“prefer 400 validation”** still fail on several cases because the **currently deployed** cluster does not yet run the full **`validation.ts`** PR — expect those checks to turn green after **`fix/listings-validation-response-handling`** is built and rolled out (`SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh`).

---

## Suggested reviewer checklist

- [ ] Skim `LISTINGS_VALIDATION_DEEP_REVIEW.md` §F (geo / scope vs `main`) — confirm with listings PR author if needed.
- [ ] Run `pnpm run k6:listings:concurrency` and `pnpm run k6:listings:malformed` against your edge after deploy.
- [ ] Confirm preflight header comments match hook order in `k6-suite-resource-hooks.sh`.

---

## Commands (quick)

```bash
pnpm --filter listings-service build
pnpm run k6:listings:concurrency
pnpm run k6:listings:malformed
DUAL_PAIR=messaging+listings pnpm run k6:dual:contention
```
