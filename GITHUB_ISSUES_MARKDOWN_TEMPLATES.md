GITHUB ISSUE TEMPLATES — MARKDOWN (READY TO PASTE)
===================================================

Rule for EVERY issue title
--------------------------
Use this exact prefix:

After PR1 complete: <issue title>

Where PR1 = canonical setup + baseline behavior documented in GITHUB_PR_DESCRIPTION.txt.

Colima rebuild cheat sheet (which script?)
------------------------------------------

**Canonical, full text:** **`GITHUB_ISSUES_EXECUTABLE.txt`** → section **Colima rebuild cheat sheet (which script?)** (same table + decision path + `pnpm` shortcuts + flags). **README.md** has the same summary table.

**Per issue:** In **`GITHUB_ISSUES_EXECUTABLE.txt`**, every **Issue N** block includes **Rebuild after code changes (this issue)** with the same four-line command matrix plus **This issue:** (which row applies for that scope). Copy that subsection into the GitHub issue body when you file it so assignees see exactly what to run.

**Prereqs:** Colima running, `kubectl` at local k3s, commands from **repo root**.

**Two scripts**

| Script | Use when |
|--------|----------|
| `scripts/rebuild-housing-colima.sh` | You changed **`webapp/`** (Next.js) or need Maps key in bundle; optionally list backends via `SERVICES=...` |
| `scripts/rebuild-och-images-and-rollout.sh` | You changed **only** backend code under **`services/`** |

**Quick picks**

| You changed | Run |
|-------------|-----|
| Webapp + default listings | `./scripts/rebuild-housing-colima.sh` or `pnpm run rebuild:housing:colima` |
| One backend only | `SERVICES=<name> ./scripts/rebuild-och-images-and-rollout.sh` or `pnpm run rebuild:service:<name>` |
| Several backends, no webapp | `SERVICES="a b" ./scripts/rebuild-och-images-and-rollout.sh` |
| Webapp + multiple backends | `SERVICES="listings-service auth-service" ./scripts/rebuild-housing-colima.sh` |

**Deprecated:** `scripts/rebuild-webapp-listings-colima.sh` → use `rebuild-housing-colima.sh`.

**Docs:** `docs/WEBAPP_GOOGLE_MAPS_AND_DEPLOY.txt` · `GITHUB_PR_DESCRIPTION.txt` (testing / rollout).

---

## Template 1 — k6 multi-service coverage

Title:
After PR1 complete: add multi-service k6 coverage for login + listings flow

Body:
### Context
PR1 baseline must be merged and environment passing preflight before this issue starts.

### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- scripts/load/k6-auth-service-health.js
- scripts/load/k6-listings-health.js
- scripts/load/k6-search-watchlist.js

### Steps
1. Inspect existing k6 scripts: `ls scripts/load/k6-*.js`
2. Add login -> fetch listings sequence.
3. Use `scripts/load/k6-strict-edge-tls.js` conventions.
4. Run:
   - `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/k6-exec-strict-edge.sh scripts/load/k6-search-watchlist.js`
5. Post p50/p95/p99 + error rate in issue.

### Success criteria
- Auth + listings endpoints both receive traffic.
- Metrics visible in output.
- Unexpected errors <= 1%.

### Scope guard
Do not change unrelated code.

---

## Template 2 — architecture/request flow docs

Title:
After PR1 complete: add architecture/request-flow docs for first-time contributors

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- README.md

### Steps
1. Add diagram: client -> ingress -> gateway -> service -> database.
2. Label auth, listings, trust, analytics, media.
3. Add two request examples (login, listings search).
4. Link first-time sections in `GITHUB_PR_DESCRIPTION.txt`.

### Success criteria
- Diagram readable in GitHub.
- New teammate understands flow quickly (<2 min).

### Scope guard
No unrelated refactors.

---

## Template 3 — listings search performance

Title:
After PR1 complete: improve listings search query latency (target p95 reduction)

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/listings-service
- supporting SQL/index changes if needed

### Steps
1. Baseline run:
   - `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/k6-exec-strict-edge.sh scripts/load/k6-listings-health.js`
2. Analyze query:
   - `./scripts/perf/explain-listings-search.sh`
3. Apply one optimization (index or query simplification).
4. Re-run baseline and compare p95.

### Success criteria
- p95 reduced vs baseline.
- No regressions on empty/invalid filters.

---

## Template 4 — analytics event validation

Title:
After PR1 complete: validate analytics event emission for key user actions

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/analytics-service
- event-layer verification paths

### Steps
1. Trigger login + listing create events.
2. Run: `./scripts/run-event-layer-verification.sh`
3. Validate required event fields and shape.
4. Add clear warnings for missing/invalid payloads.

### Success criteria
- Events emitted for tested actions.
- Invalid events are clearly detectable.

---

## Template 5 — auth stability/logging

Title:
After PR1 complete: improve auth-service logging and edge-case response consistency

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/auth-service

### Steps
1. Add logs for login success/fail and signup.
2. Test invalid token + expired session behavior.
3. Normalize error payload shape and status mapping.
4. Run:
   - `./scripts/test-auth-service.sh`
   - `./scripts/test-housing-stack-wiring.sh`

### Success criteria
- Auth outcomes visible in logs.
- Error responses consistent and readable.

---

## Template 6 — trust moderation consistency

Title:
After PR1 complete: stabilize trust moderation and listing flagging workflow

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/trust-service

### Steps
1. Test duplicate flag and invalid target flows.
2. Ensure idempotent duplicate handling.
3. Normalize error responses.
4. Validate trust UI/API behavior end-to-end.

### Success criteria
- No duplicate-flag state corruption.
- Predictable error behavior.

---

## Template 7 — request latency observability

Title:
After PR1 complete: add latency logging and slow-request markers (listings + trust)

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/listings-service
- services/trust-service

### Steps
1. Add request timing logs (endpoint + ms).
2. Mark >100ms as `SLOW REQUEST`.
3. Run:
   - `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh`
4. Capture sample normal + slow logs.

### Success criteria
- Per-request latency visible.
- Slow requests easy to identify.

---

## Template 8 — listings validation + response consistency

Title:
After PR1 complete: harden listings input validation and response consistency

Body:
### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- services/listings-service
- webapp consumer expectations (if shape changes)

### Steps
1. Add validation for missing/invalid fields.
2. Ensure consistent success/error response envelopes.
3. Run:
   - `./scripts/test-listings-http2-http3.sh`
   - `./scripts/test-microservices-http2-http3-housing.sh`
   - `pnpm run test:webapp:e2e:listings`

### Success criteria
- Invalid input rejected cleanly.
- Response format consistent.

---

Contributor note (Cursor prompt)
--------------------------------
Use:
"Follow this issue exactly. Implement step-by-step. Do not change unrelated code. Run listed commands and paste result summary."


## Template 9 — tail latency optimization (advanced)

Title:
After PR1 complete: optimize tail latency (p95/p99) under concurrent load

Body:
### Context
Target high p95/p99 under concurrency with reproducible before/after evidence.

### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- Cross-service path via edge/gateway + core services
- k6 orchestration + contention visibility + perf reporting

### Steps
1. Baseline:
   - `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh`
2. Second terminal contention watcher:
   - `./scripts/perf/watch-cluster-contention.sh`
3. Isolation runs:
   - `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/perf/run-k6-cross-service-isolation.sh`
4. Reporting:
   - `./scripts/perf/run-perf-full-report.sh`
5. Apply one optimization at a time and re-run.
6. Document p50/p95/p99 + error deltas and bottleneck explanation.

### Success criteria
- Tail latency improved with reproducible runs.
- No error-rate regression.
- Evidence attached (logs/reports).

---

## Template 10 — cross-service performance analysis

Title:
After PR1 complete: perform cross-service performance analysis and bottleneck mapping

Body:
### Context
System-wide analysis issue (not a single-service tweak).

### Already done (PR1 baseline)
- First-time setup, cert/TLS, and preflight baseline are already established.
- Use canonical rebuild scripts (`rebuild-housing-colima.sh` / `rebuild-och-images-and-rollout.sh`).

### Scope
- Analyze k6 outputs across services
- Identify bottlenecks
- Document findings + prioritized optimization plan

### Steps
1. Integrated run:
   - `RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh`
2. Phase run:
   - `./scripts/load/run-k6-phases.sh`
3. Reports:
   - `./scripts/perf/run-all-k6-load-report.sh`
   - `./scripts/perf/run-all-explain.sh`
4. Build bottleneck matrix by flow/service.
5. Classify bottlenecks (code/infra/load-shape).
6. Publish findings under `docs/perf/`.
7. Create P0/P1/P2 follow-up issues from findings.

### Success criteria
- Cross-service bottlenecks documented with evidence.
- Prioritized, actionable optimization plan published.

---


## Template 11 — webapp UX consistency and theming

Title:
After PR1 complete: align webapp styling and UX consistency across pages

Body:
### Already done (PR1 baseline)
- Core webapp routes and Playwright project setup are already available.
- Baseline light palette direction exists and should be made consistent.

### Scope
- webapp/app/*/page.tsx
- webapp/components/Nav.tsx
- shared form/card/button styling patterns

### Steps
1. Audit visual inconsistency across pages (background, type scale, spacing, buttons).
2. Normalize shared class patterns (avoid one-off styling drift).
3. Regenerate screenshots:
   - `E2E_SCREENSHOTS=1 ./scripts/webapp-playwright-strict-edge.sh --project=05-optional-screenshots`
4. Attach before/after screenshots in issue.

### Success criteria
- Unified look and feel across core pages.
- No navigation or baseline UX regressions.

---

## Template 12 — frontend contribution pack

Title:
After PR1 complete: add frontend contribution tasks and runbook for webapp updates

Body:
### Already done (PR1 baseline)
- Playwright test matrix and rebuild scripts are available.

### Scope
- webapp/README.md
- docs/webapp contribution notes
- issue templates linkage

### Steps
1. Add frontend quickstart: edit paths, test commands, rebuild commands.
2. Add task list for contributors (UI polish, validation, loading/error, empty states).
3. Include exact commands:
   - `pnpm run test:webapp:e2e:smoke`
   - `pnpm run test:webapp:e2e:listings`
   - `./scripts/rebuild-housing-colima.sh`

### Success criteria
- New contributor can go from edit to deploy verification without asking for infra help.

---
