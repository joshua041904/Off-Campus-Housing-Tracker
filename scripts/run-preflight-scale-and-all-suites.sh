#!/usr/bin/env bash
# Pre-test: preflight → API ready → scale → reissue CA+leaf → re-ensure API →
# verify Caddy strict TLS (no curl 60) → strict TLS check → pod/DB/Redis → all suites.
# Must be run with bash (uses process substitution, [[ ]], etc.). Re-exec with bash if invoked as sh.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
#
# Breakdown (what this script does):
#   1. Context: When REQUIRE_COLIMA=0 (e.g. k3d), keeps current context and uses in-cluster Caddy verify (no port-forward). When REQUIRE_COLIMA=1, prefers Colima context and host/tunnel-based verify.
#   2. Phase 1A: Read-only API and cluster checks. Phase 1B: Reissue CA+leaf, Kafka SSL, remove in-cluster DB/Kafka, scale to baseline (1 replica per app, 2 Caddy).
#   3. Caddy strict TLS: On k3d/REQUIRE_COLIMA=0 uses verify-caddy-strict-tls-in-cluster.sh (curl from a pod). On Colima may use NodePort or port-forward.
#   4. Strict TLS/mTLS preflight: ensure-strict-tls-mtls-preflight.sh (service-tls + dev-root-ca chain).
#   5. Optional pgbench: step 8 when RUN_PGBENCH=1. Step 7a runs verify pods → Vitest (event-layer + messaging + media) →
#      test-microservices-http2-http3-housing.sh + test-messaging-service-comprehensive.sh → k6 edge grid → Playwright (see _run_all_suites).
#      For a separate full rotation/load matrix (auth, rotation, run-k6-phases, etc.), run ./scripts/run-all-test-suites.sh manually.
#
# Green team / first machine: read docs/PR_SECOND_ONBOARDING.md — Colima + DB restore (RESTORE_BACKUP_DIR=latest),
# CA bundle + Kafka JKS (docs/CERT_GENERATION_STRICT_TLS_MTLS.md), curl 8.19+ on PATH, then this script.
# Preflight auto-checks local cert material and bootstraps missing files (dev-root.pem/key, off-campus-housing leaf,
# kafka-ssl JKS/password files) via scripts/dev-generate-certs.sh at step 1c; it also retries kafka-ssl-from-dev-root.sh.
#
# Use: ./scripts/run-preflight-scale-and-all-suites.sh
#   REQUIRE_COLIMA=0  use k3d (default for preflight). REQUIRE_COLIMA=1  use Colima + k3s (primary). With REQUIRE_COLIMA=1 and METALLB_ENABLED=1 preflight uses install-metallb-colima.sh, caddy-h3-service-loadbalancer.yaml, and ensures :dev images (no k3d registry/3c0/3c0a/3c0b). Colima only used optionally for L2 verification when REQUIRE_COLIMA=0 (METALLB_VERIFY_COLIMA_L2=1).
# Get ready first: ./scripts/ensure-ready-for-preflight.sh
# Host tools (curl HTTP/3, tcpdump, tshark, htop): ./scripts/install-preflight-tools.sh (run once)
# Layers: docs/PREFLIGHT_AND_DIAGNOSTICS.md and docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md
#
# Cluster stopped / API unreachable (be aware — get the cluster back before expecting preflight to pass):
#   - `colima list` shows **Stopped** and **ADDRESS** empty until the VM runs — then ADDRESS is the VM IP (e.g. 192.168.64.x).
#   - Colima + k3s: `colima start --with-kubernetes`. If start fails with **disk "colima" in use** / attach error, try
#     `colima stop --force` then `colima start --with-kubernetes` (clears stale Lima sockets; see Colima issues).
#   - **Host kubectl → 127.0.0.1:6443**: if API is **refused** while Colima is **Running**, run `./scripts/colima-forward-6443.sh`
#     (this script also invokes it when context is colima — step 1).
#   - **COLIMA_START=1** (default): merges kubeconfig and may start Colima when no Colima context exists (see step 1).
#   - Context: `kubectl config use-context colima`; kubeconfig under ~/.kube/config or ~/.colima/... per your Colima version.
#   - k3d: `k3d cluster list` / `k3d cluster start <name>`; `kubectl config use-context k3d-...`.
#   - Gate: `./scripts/ensure-ready-for-preflight.sh` — step 3 uses ensure-api-server-ready when needed.
#
# Single source of truth for CA: certs/dev-root.pem at repo root.
#   - Reissue (3a) writes certs/dev-root.pem; ensure-strict-tls-mtls-preflight (5) syncs it from cluster.
#   - Linux / Docker k6: SSL_CERT_FILE=certs/dev-root.pem is honored for TLS verify.
#
# macOS + host k6 (Homebrew k6): Go uses Security.framework — SSL_CERT_FILE does NOT fix x509 for
#   https://off-campus-housing.test. Step 7a runs ./scripts/lib/trust-dev-root-ca-macos.sh automatically
#   before k6 (adds dev-root to login keychain; re-run after CA rotation). Overrides:
#   SKIP_MACOS_DEV_CA_TRUST=1 — you already trusted the CA manually.
#   K6_USE_DOCKER_K6=1 — use grafana/k6 in Docker for other k6 flows (Linux; SSL_CERT_FILE works). Housing edge smoke uses host k6 only.
#   PREFLIGHT_STRICT_MACOS_K6_TRUST=0 — if keychain step fails, continue anyway (k6 may still x509).
#
# Ensures:
#   - API server ready (mandatory); re-checked after reissue
#   - off-campus-housing-tracker: service 1, exporters 1, envoy-test 1, Caddy 2
#   - Reissue CA + leaf (dev-root-ca / off-campus-housing-local-tls match); verify no curl 60
#   - Strict TLS (CA + leaf), Kafka external strict TLS :29094 (housing; RP uses 29093), no in-cluster Postgres/Kafka/ZK
#   RUN_SUITES=0 skip test suites.
#   PREFLIGHT_APP_SCOPE=full|core — which Deployments to scale and wait for (default full).
#     core = auth-service api-gateway messaging-service media-service (finishes without listings/booking/trust/analytics).
#     Override exact list: PREFLIGHT_APP_DEPLOYS="auth-service api-gateway messaging-service"
#   RUN_MESSAGING_LOAD=1 (default) — after Vitest + housing scripts, run k6 edge smoke grid (run-housing-k6-edge-smoke.sh) if k6 is installed.
#   RUN_K6_SERVICE_GRID=0 — skip the full k6 per-service smoke (gateway, auth, listings, booking health, trust, analytics, messaging, media, event-layer + booking/search JWT).
#   RUN_PREFLIGHT_PLAYWRIGHT=0 — skip Playwright E2E (https edge /api/readyz wait + tests against E2E_API_BASE).
#   PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=0 — set 1 to run scripts/load/k6-messaging-limit-finder.js after the edge grid (long ramping-arrival-rate; uses k6-strict-edge-tls.js). Default off.
#   PREFLIGHT_VERBOSE_HOUSING_MESSAGING_SUITE=1 — step 7a: show "Housing HTTP/2 + HTTP/3 suite done" and run ensure-messaging-schema.psql (noisy DDL). Default: quieter preflight (schema already applied by bring-up / migrations; re-run manually if needed: ./scripts/ensure-messaging-schema.sh).
#   PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1 — exit after step 7a (Vitest + housing HTTP suite + k6 grid + Playwright); skip transport study / in-cluster k6 / step 8 pgbench. make demo sets this to 1; make demo-full sets 0.
#     Set RUN_MESSAGING_LOAD=0 to skip. Tune: K6_MESSAGING_DURATION, K6_MESSAGING_RATE, K6_MESSAGING_VUS, K6_MEDIA_*.
#   Preflight does not apply DB migrations or infra/db/*.sql by default; run scripts/setup-*-db.sh or scripts/ensure-*.sh manually when schema changes.
#   Exception: PREFLIGHT_PHASE_D_TAIL_LAB=1|full runs scripts/perf/run-preflight-phase-d-tail-lab.sh after the k6 edge grid, which **best-effort** runs
#     ensure-listings-schema.sh against host postgres-listings (PGHOST/PGPORT) and run-all-explain.sh when DBs are reachable.
#   PREFLIGHT_PHASE_D_TAIL_LAB — default **full** (Phase D + cross-service isolation). Set 0|off to skip; 1 = Phase D without forcing cross-iso (unless PREFLIGHT_PHASE_D_CROSS_ISO=1).
#   PREFLIGHT_PHASE_D_SKIP_SCHEMA / PREFLIGHT_PHASE_D_SKIP_EXPLAIN / PREFLIGHT_PHASE_D_PG_SNAPSHOT — see scripts/perf/run-preflight-phase-d-tail-lab.sh
#   CAPTURE_STOP_TIMEOUT=30 (default when running suites) — bounds packet capture stop phase so it never blocks; set higher for full pcap copy/analyze.
#   PREFLIGHT_TELEMETRY=1 (default) capture control-plane telemetry during run (apiserver metrics every 8s) and post-run snapshot; set 0 to disable. TELEMETRY_PERF=1 / TELEMETRY_HTOP=1 for optional perf/htop. run-preflight-with-telemetry.sh is a thin wrapper that sets PREFLIGHT_MAIN_LOG and RUN_FULL_LOAD=0.
#
#   --- Load-lab orchestration (step 7a k6 edge grid): interference, not infra saturation ---
#   When TIME_WAIT and conntrack stay low, node CPU looks moderate, and standalone k6 scripts are clean — but
#   p95 spikes only inside the full suite — that points to orchestration concurrency bleed through the shared
#   api-gateway (back-to-back k6), not kernel limits or Colima "being broken". You are tuning the load lab, not
#   fighting the network stack. Next step if still noisy: instrument the gateway event loop (profiling), not only sysctl.
#
#   Mitigations are implemented in run-housing-k6-edge-smoke.sh (preflight 7a) + scripts/lib/k6-suite-resource-hooks.sh.
#
#   Step 1 — Active drain between k6 runs (wait until gateway CPU < ~150m before the next test — reduces overlap):
#     Illustrative one-liner (fragile parsing; production code uses awk on pod names + millicores — see hooks):
#       # echo "Waiting for gateway to drain..."
#       # until kubectl top pods -n off-campus-housing-tracker | grep api-gateway | awk '{print $2}' | sed 's/m//' | awk '{exit !($1 < 150)}'; do sleep 2; done
#     Implemented: K6_SUITE_GATEWAY_DRAIN=1, K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES=150,
#       K6_SUITE_GATEWAY_DRAIN_INTERVAL_SEC=2, K6_SUITE_GATEWAY_DRAIN_TIMEOUT_SEC=120 — k6_suite_wait_gateway_drain()
#       in k6-suite-resource-hooks.sh. Requires metrics-server for kubectl top.
#
#   Step 2 — Disable constant-arrival-rate for multi-service orchestration (CAR = stress; not the default grid):
#     scripts/load/k6-messaging.js + k6-media-health.js use ramping-vus (e.g. startVUs 2, stages 10s/10s/5s) when
#     K6_ORCHESTRATION_VU_SCENARIO=1 (default in run-housing-k6-edge-smoke.sh). Set =0 for legacy CAR + CAR-extra cooldown.
#
#   Step 3 — Hard stop after drain + settle (kills ALL host k6; use a dedicated terminal if you run other k6 jobs):
#     run-housing-k6-edge-smoke.sh defaults K6_SUITE_KILL_K6_AFTER_BLOCK=1 → pkill -9 -x k6 when any exists.
#     K6_SUITE_POST_DRAIN_SLEEP_SEC=10 default in that script (fixed 10s after gateway idle); optional K6_SUITE_POST_KILL_K6_SLEEP_SEC after kill.
#
#   Final form (after every k6 block, k6_suite_after_k6_block order):
#     1) kubectl top snapshot + optional node CPU fail
#     2) wait for api-gateway CPU to drop (K6_SUITE_GATEWAY_DRAIN — active drain loop)
#     3) post-drain sleep (K6_SUITE_POST_DRAIN_SLEEP_SEC — default 10s in edge smoke)
#     4) SIGKILL lingering k6 if K6_SUITE_KILL_K6_AFTER_BLOCK=1 (+ optional K6_SUITE_POST_KILL_K6_SLEEP_SEC)
#     5) cooldown (K6_SUITE_COOLDOWN_SEC) + optional CAR extras / Envoy restart
#   Re-run the full suite after changing hooks to validate; if listings stays stable, you have evidence of suite interference.
#
#   k6 suite stability (orchestration — reduces cross-test contention on Colima/k3s; see scripts/lib/k6-suite-resource-hooks.sh):
#     K6_SUITE_COOLDOWN_SEC=15 — sleep after every k6 block; K6_SUITE_CAR_EXTRA_SEC=20 — extra after constant-arrival-rate scripts.
#     K6_SUITE_LOG_TOP=1 — kubectl top nodes + pods after each block; K6_SUITE_FAIL_ON_NODE_CPU=1 — exit hook code 3 if any node CPU% ≥ K6_SUITE_NODE_CPU_MAX (default 85). Set K6_SUITE_FAIL_ON_NODE_CPU=0 to only log.
#     K6_SUITE_RESTART_ENVOY_AFTER_CAR=0 — set 1 to rollout restart deployment/envoy-test in envoy-test after each CAR test (+ K6_SUITE_ENVOY_RESTART_SLEEP_SEC=10).
#     K6_SUITE_RESOURCE_LOG / K6_SUITE_RESOURCE_LOG_AUTO=1 — append kubectl top snapshots to $PREFLIGHT_RUN_DIR/k6-suite-resources.log (AUTO on in step 7a; proves contention offline).
#     K6_SUITE_STABILITY_AGGRESSIVE=1 — enables Envoy restart after CAR by default (clears connection state; disruptive).
#     K6_SUITE_LOG_TOP_BEFORE=1 — snapshot before each k6 run; K6_SUITE_COLIMA_DROP_CACHES=1 — colima ssh sync+drop_caches before each k6 (harsh lab; Colima VM only).
#     K6_SUITE_WARN_HOT_RESOURCES=1 (default) — stderr warnings when node CPU%/MEM% ≥ K6_SUITE_WARN_NODE_CPU / _MEM (default 80); fail still at K6_SUITE_NODE_CPU_MAX (85).
#     K6_SUITE_GATEWAY_DRAIN=1 — after each k6 block, wait until api-gateway pod CPU (kubectl top) < K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES (default 150m); needs metrics-server. run-housing-k6-edge-smoke.sh defaults this on.
#     K6_ORCHESTRATION_VU_SCENARIO=1 — in edge smoke, messaging + media k6 scripts use ramping-vus instead of constant-arrival-rate (less iteration drop / shared-gateway interference). Set 0 for legacy CAR stress.
#     K6_SUITE_KILL_K6_AFTER_BLOCK=1 — default in run-housing-k6-edge-smoke.sh; SIGKILL lingering k6 (all k6 on host). Set 0 to disable.
#     K6_SUITE_POST_DRAIN_SLEEP_SEC=10 — default in edge smoke after gateway drain; K6_SUITE_POST_KILL_K6_SLEEP_SEC optional after kill.
#     Second terminal (prove contention): kubectl top pods -n off-campus-housing-tracker; kubectl top nodes — watch CPU/mem >80%, Postgres/Envoy spikes.
#     Continuous log: scripts/perf/watch-cluster-contention.sh → bench_logs/cluster-contention-watch-*.log (docs/perf/CLUSTER_CONTENTION_WATCH.md).
#
#   scripts/perf/ — lab & reporting:
#     run-preflight-phase-d-tail-lab.sh — **auto** when PREFLIGHT_PHASE_D_TAIL_LAB=1 or full (after step 7a k6 grid); else run manually.
#     watch-cluster-contention.sh — second terminal: poll kubectl top → bench_logs/cluster-contention-watch-*.log
#     run-k6-cross-service-isolation.sh — each edge k6 script in isolation (also inside Phase D when TAIL_LAB=full)
#     run-perf-full-report.sh — EXPLAIN all housing DBs + k6 aggregation → bench_logs/perf-report-*/
#     run-all-explain.sh — EXPLAIN-only (uses sql/explain-*.sql); part of Phase D
#     run-all-k6-load-report.sh — k6 JSON summaries → markdown/html report
#     explain-listings-search.sh — listings search EXPLAIN helper
#     sql/explain-*.sql — auth, messaging, notification, listings, media, trust, analytics, bookings
#     See docs/perf/README.md, docs/perf/TAIL_OPTIMIZATION_PHASE_D_REPORT.md, docs/perf/TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md
#
#   Step 7a invokes scripts/run-housing-k6-edge-smoke.sh. Preflight also calls _preflight_export_k6_orchestration_defaults
#   (after sourcing k6-suite-resource-hooks.sh) so K6_ORCHESTRATION_VU_SCENARIO, K6_SUITE_GATEWAY_DRAIN, POST_DRAIN_SLEEP,
#   KILL_K6_AFTER_BLOCK, drain thresholds, etc. are set in this process even if edge-smoke defaults change — override via env anytime.
#   Preflight 7a sets K6_SUITE_RESOURCE_LOG_AUTO=1 → $PREFLIGHT_RUN_DIR/k6-suite-resources.log unless disabled.
#
#   --- Issue 9 & 10 playbook (tail latency + cross-service perf; self-contained reference, mirrors GITHUB_ISSUES_EXECUTABLE.txt) ---
#
#   Issue 9 — Tail Latency Optimization (Advanced)
#   Title: After PR1 complete: optimize tail latency (p95/p99) under concurrent load
#   Already done (PR1): first-time path GITHUB_PR_DESCRIPTION.txt §4; rebuild scripts rebuild-housing-colima.sh +
#     rebuild-och-images-and-rollout.sh; cert/JKS preflight bootstrap (step 1c).
#   Scope: cross-service via edge/gateway (auth, listings, booking, trust, analytics, media); k6 orchestration + hooks +
#     bench_logs/.
#   Rebuild after code: one backend SERVICES=<n> ./scripts/rebuild-och-images-and-rollout.sh or pnpm rebuild:service:*;
#     several backends SERVICES="a b" .../rebuild-och-images-and-rollout.sh; webapp + default listings
#     ./scripts/rebuild-housing-colima.sh; webapp + many SERVICES="..." ./scripts/rebuild-housing-colima.sh.
#     k6-only edits do not require image rebuild unless you change services.
#   Problem: high tails under concurrency (unstable p95/p99), not single-endpoint microbench.
#   Preconditions: PR1 merged; off-campus-housing.test + certs/dev-root.pem; kubectl get pods -n off-campus-housing-tracker.
#   Load-lab orchestration (before sysctl / “network exhaustion”): this script exports K6_ORCHESTRATION_VU_SCENARIO=1
#     (messaging/media ramping-vus not CAR), K6_SUITE_GATEWAY_DRAIN=1, max 150m, POST_DRAIN_SLEEP 10s,
#     K6_SUITE_KILL_K6_AFTER_BLOCK=1 (pkill -9 -x k6; set 0 if another terminal runs k6). Hook order: drain → post-drain
#     sleep → kill → cooldown — scripts/lib/k6-suite-resource-hooks.sh. Low TIME_WAIT/conntrack + moderate node CPU but
#     suite-only p95 spikes → orchestration / shared api-gateway — docs/perf/TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md.
#   Execution plan:
#     1) SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/run-housing-k6-edge-smoke.sh  (or full preflight this file)
#     2) Second terminal: ./scripts/perf/watch-cluster-contention.sh
#     3) SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/perf/run-k6-cross-service-isolation.sh
#     4) ./scripts/perf/run-perf-full-report.sh  (or ./scripts/perf/run-all-k6-load-report.sh if DB tight)
#     5) Top 3 contention points: gateway queue, endpoint tails, DB index, Envoy/Caddy
#     6) One change at a time: query/index, batching, sync calls, K6_SUITE_* tuning
#     7) Re-run same load profile
#     8) Document p50/p95/p99, error rate, resource trend
#   Artifacts: baseline vs after; bench_logs/k6-suite-resources-*.log; contention watcher log; bench_logs/perf-report-*
#   Success: material p95/p99 improvement, no error regression, 2+ consecutive runs, documented root cause.
#
#   Issue 10 — Cross-Service Performance Analysis (System-Wide)
#   Title: After PR1 complete: perform cross-service performance analysis and bottleneck mapping
#   Scope: full-stack under load; k6 correlation; bottleneck map + prioritized plan.
#   Rebuild: none for docs/k6-only; else several backends / webapp+housing script per cheat sheet.
#   Objective: where latency/error amplifies across boundaries; what to optimize first.
#   Load-lab: preflight 7a runs run-housing-k6-edge-smoke.sh with exports above; compare full suite vs isolation script;
#     if kernel tables and node CPU not saturated, attribute delta to order effects / shared api-gateway
#     (TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md).
#   Workflow:
#     1) RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh  (integrated baseline)
#     2) ./scripts/load/run-k6-phases.sh
#     3) ./scripts/run-transport-study-experiments.sh  (if needed)
#     4) ./scripts/perf/run-all-k6-load-report.sh + ./scripts/perf/run-all-explain.sh  (optional run-perf-full-report.sh)
#     5) Bottleneck matrix per flow: ingress/gateway, service, DB, downstream, p95/p99
#     6) Classify: Code path | Infra/path | Load-shape
#     7) Prioritize P0/P1/P2
#     8) Write docs/perf/*.md: methodology, tables, matrix, plan
#   Deliverables: merged markdown report; issue summary with top 5 bottlenecks, expected gains, follow-up issues.
#   Success: cross-service analysis with evidence; actionable prioritized plan.
#
#   --- Step 7a — testing matrix (edge + services; what preflight runs vs run manually) ---
#   Playwright E2E (7a8): run-playwright-e2e-preflight.sh → waits for E2E_API_BASE/api/readyz, then
#     scripts/webapp-playwright-strict-edge.sh → pnpm exec playwright test (webapp/playwright.config.ts).
#     Current inventory: 23 Playwright tests in 10 spec files, grouped into 5 projects (01-guest-shell,
#     02-auth-booking, 03-listings, 04-analytics, 05-optional-screenshots). 22 run by default; ui-screenshots
#     skips unless E2E_SCREENSHOTS=1. See GITHUB_PR_DESCRIPTION_LISTINGS_E2E.txt for commands and matrix.
#   k6 shared module: scripts/load/k6-strict-edge-tls.js — imported by all edge k6 scripts (BASE_URL, TLS CA, tags).
#   k6 in default preflight grid: run-housing-k6-edge-smoke.sh → gateway/auth/listings/booking/trust/analytics/
#     messaging/media/event-layer + optional analytics-listing-feel + JWT booking/search (see script triples).
#   k6 NOT in default preflight (run ad hoc or enable limit-finder env): k6-messaging-limit-finder.js (envelope),
#     k6-limit-test-comprehensive.js + k6-find-max-rps-http3.js (run-k6-phases / perf), k6-messaging-e2e.js,
#     k6-messaging-flow.js, k6-reads.js phases, service-specific ramps (k6-*-ramp.js), k6-notification-health.js, etc.
#   scripts/perf/: watch-cluster-contention.sh, run-k6-cross-service-isolation.sh, run-perf-full-report.sh,
#     run-all-explain.sh, explain-listings-search.sh — not auto-invoked; use second terminal or after preflight.
#   Service coverage goal: each app should have Vitest/unit where applicable, bash integration (housing suite),
#     k6 health via edge grid, and Playwright for webapp surfaces — extend k6/e2e when new routes ship.
#   Certs / GitGuardian: never commit keys under certs/ — docs/SECURITY_CERTS_REPOSITORY.md, scripts/check-certs-not-in-git.sh
#
#   RUN_FULL_LOAD=1 (default) run pgbench (all DBs, deep) + k6 + xk6 HTTP/3 phases + all suites (full control plane). Set RUN_FULL_LOAD=0 for suites only.
#   RUN_K6=1 run k6 load phase; RUN_PGBENCH=1 run pgbench sweeps before suites (set by RUN_FULL_LOAD=1).
#   When RUN_FULL_LOAD=1: K6_PHASES=read,soak,limit,max, K6_HTTP3=1, K6_HTTP3_PHASES=1 (run-k6-phases.sh runs xk6-http3 phases). Step 6d builds xk6-http3 if missing; SKIP_XK6_BUILD=1 to skip.
#   KILL_STALE_FIRST=1 (default) kill stale pipeline/test processes before running; set 0 to skip.
#   SKIP_API_SERVER_CHECK=1 skip step 3 (use only if API check is flaky and Colima is known good).
#   COLIMA_START=1 (default) if API not reachable, start Colima and wait for 127.0.0.1:6443. Set 0 to fail fast.
#   COLIMA_TEARDOWN_FIRST=1 — run ./scripts/colima-teardown-and-start.sh first (full teardown + start + 6443 tunnel), then proceed. Use when reissue hits 49400/connection refused.
#   Teardown and fresh start (manual): ./scripts/colima-teardown-and-start.sh then re-run this script.
#
# Phase-gated (Colima control-plane stabilization): docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md
#   PREFLIGHT_PHASE=A|B|C|D|full — A=control-plane sanity, B=cert only, C=data-plane load, D=MetalLB, full=all (default).
#   METALLB_ENABLED=0 (default) — skip MetalLB install and Caddy LoadBalancer; use NodePort Caddy. Set 1 for Phase D or full+LB.
#   METALLB_POOL — Colima default 192.168.64.240-192.168.64.250 (VM network so host can reach LB IP). Override if your VM uses another subnet.
#   PREFLIGHT_METALLB_WEBHOOK_WAIT — polls (5s each) for MetalLB webhook in install-metallb-colima.sh; default 48 (4 min) when run from preflight 3c1-early. Set higher if webhook is slow.
#   METALLB_FRR_BGP=0 (default) — skip FRR BGP. Set 1 with METALLB_ENABLED=1 for BGP verification (fails gracefully to L2).
#   METALLB_VERIFY_COLIMA_L2=0 (default) — set 1 to run MetalLB L2/BGP verification on Colima in step 3c1c only; preflight and suites stay on k3d. Colima must be running (colima start --with-kubernetes); kubeconfig is merged automatically for 3c1c.
#   METALLB_FRR_BGP=0 (default) — set 1 (or use with METALLB_VERIFY_COLIMA_L2=1 for full BGP) to deploy FRR and BGPPeer in step 3c1a for BGP verification.
#   PREFLIGHT_K3D_API_STABILIZE_SLOTS=90 (default) — on k3d after node restart (3c0a), wait up to this many 5s slots (90 = 7.5 min) for API to stabilize before MetalLB/Caddy. Increase (e.g. 120) if API not stable in 7.5 min.
#   PREFLIGHT_K3D_EXPECTED_NODES=2 — require this many nodes; all must be Ready before heavy steps (default 2 for 2-node cluster).
#   PREFLIGHT_K3D_NODES_READY_WAIT=120 — max seconds to wait for all nodes Ready after API is up (default 120). Set 0 to skip wait.
#   PREFLIGHT_ENSURE_IMAGES=1 (default) — Colima: build missing :dev images (in parallel, max 4). When any are missing this step can take 5–15+ min; set PREFLIGHT_ENSURE_IMAGES=0 to skip for faster re-runs when images already exist. k3d: verify images in registry; set 0 to skip.
#   APPLY_RATE_LIMIT_SLEEP=2 — seconds between kubectl apply batches (reduces API burst).
#
# Packet capture (step 7 suites): CAPTURE_STOP_TIMEOUT=30 and CAPTURE_MAX_STOP_SECONDS=75 are exported so baseline/enhanced capture stop phase never blocks (quick first-packet only when timeout set; full copy capped at 75s).
#   In-pod Caddy: CAPTURE_STRICT_ENDPOINT_BPF=1 (default) → BPF (tcp|udp) dst podIP:443; post-verify stray UDP/443 (dst != pod) must be 0. CAPTURE_EXPECTED_SNI=off-campus-housing.test (OCH edge; not record.local). STRICT_QUIC_VALIDATION=1 / CAPTURE_ENFORCE_QUIC_SNI=1 tighten failures. Host/VM pcaps: dst MetalLB TARGET_IP.
#
# Example (k3d + MetalLB, suites only): METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh
# Example (Colima + MetalLB, full preflight + k6 + all suites, no pgbench): METALLB_ENABLED=1 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh
#   RUN_PGBENCH=0 skips step 8 (pgbench); steps 0–7 run (reissue, MetalLB, Caddy, all suites, k6 phases). REQUIRE_COLIMA=1 is auto-set when METALLB_ENABLED=1 (unless METALLB_USE_K3D=1).
#   Step 7 exports: SUITE_TIMEOUT=3600 (1h per suite; set 0 for no cap), DB_VERIFY_MAX_SECONDS=10 (fast default; set 60 for full verify), DB_VERIFY_CONNECT_TIMEOUT=3, CAPTURE_STOP_TIMEOUT=30.
#
# k3d / avoiding stuck:
#   - Step 0: kills only stale processes (other terminals/pipelines). This run's children (telemetry, ensure subprocess) are excluded; telemetry starts after step 0 so it is never killed.
#   - Phase 1B write lock: script prints "Phase 1B — acquiring write lock" before blocking. Timeout PREFLIGHT_LOCK_TIMEOUT=60s. On failure we detect stale lock (no process holding file/dir), remove it and retry once. To disable lock: PREFLIGHT_SKIP_WRITE_LOCK=1 or PREFLIGHT_WRITE_LOCK_FILE=.
#   - Step 3: ensure-api-server-ready — k3d uses ENSURE_CAP=180 (Colima 480). Set ENSURE_CAP=120 to fail faster.
#   - 3c0b (k3d): API stabilize after node restart — PREFLIGHT_K3D_API_STABILIZE_SLOTS=90 (7.5 min). Set 24 for ~2 min. Progress every 30s.
#   - Caddy apply/verify: retries with sleep 10/15/20s; PREFLIGHT_ABORT_ON_SLOW_APPLY=1 aborts if apply >10s.
#
# --- Section overview (order of execution) ---
#   0     Kill stale pipeline/test processes (preflight, run-all, tcpdump, k6). Telemetry starts after this.
#   0a    (Optional) Colima teardown + start when COLIMA_TEARDOWN_FIRST=1.
#   1     Context: Colima or k3d; merge kubeconfig, guardrail no Kind. Then trim completed pods (1), preflight kubeconfig (2).
#   2     2a–2d: Kubeconfig fix, ensure single cluster, API reachability check.
#   3     Ensure API server ready (ensure-api-server-ready.sh; k3d ENSURE_CAP=180, Colima 480). Phase 0/1A/1B/D gates.
#   3a0   Auto housing secrets: ensure-housing-cluster-secrets.sh (service-tls/dev-root-ca, och-service-tls alias,
#         och-kafka-ssl-secret). On by default; PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS=0 or SKIP_AUTO_CLUSTER_SECRETS=1 to skip.
#   3a    Reissue CA + leaf (secrets) — **default off** when cluster has service-tls + dev-root-ca (PREFLIGHT_REISSUE_CA=0).
#         Set PREFLIGHT_REISSUE_CA=1 to rotate CA every run (chaos / recovery). Bootstrap: missing secrets still runs reissue.
#         Kafka SSL (3b), Phase 1B write lock.
#   3b    3b1–3b4: Re-ensure API, Caddy strict TLS verify, scale to baseline, pod/DB/Redis/TLS checks. 3b4: no SQL applied (run ensure-* or setup-* manually).
#   3c    Colima+MetalLB: 3c1-early installs MetalLB before 3a (reissue) so webhook is ready while API is calm. 3c0-housing: kubectl apply -k each infra/k8s/base/<app> in PREFLIGHT_APP_DEPLOYS so Deployments exist before scale (fixes missing notification-service). 3c0: k3d node restart (optional). 3c0b: API stabilize. 3c1: MetalLB install (skipped on Colima if 3c1-early succeeded). 3c1a: FRR BGP. 3c2: Caddy deploy + service. 3c1b: MetalLB verify (VERIFY_MODE=stable). 3c1c: optional Colima-only L2/BGP (METALLB_VERIFY_COLIMA_L2=1). Colima pool default: METALLB_POOL=192.168.64.240-192.168.64.250 so host can reach LB IP.
#   4     Scale to baseline (1 replica per app, 2 Caddy, exporters 1, Envoy 1).
#   5     Strict TLS/mTLS preflight (ensure-strict-tls-mtls-preflight.sh). Verify Caddy strict TLS (no curl 60).
#   6     6a1–6a2: Force deployments, ensure Kafka. 6b: wait-for-all-services-ready (PREFLIGHT_READY_MAX_WAIT default 900s, INITIAL_WAIT 90s).
#         6d: build xk6-http3 if RUN_K6=1. 6e: ensure-tcpdump-in-capture-pods (before suites).
#   7     7a (Colima): ROTATION_USE_BBR=1 switches TCP congestion to BBR before suites. Run all test suites via run-all-test-suites.sh (auth, baseline, enhanced, adversarial, rotation, k6, standalone, tls-mtls, social). ROTATION_UDP_STATS=1 (Colima default) captures UDP stats pre/post k6. All 8 suites run to completion even if one fails; step 8 runs when RUN_PGBENCH=1. Step 5b inside run-all = k6 phases (HTTP/2 + xk6 HTTP/3 when K6_HTTP3=1). HTTP/3 on k3d: see docs/HTTP3-CURL-EXIT-CODES.md if baseline/enhanced hit exit 7/28/55.
#         7a3–7a7: run-housing-k6-edge-smoke.sh — k6 hooks + gateway drain + ramping messaging/media (see "k6 suite stability" + "Step 7a k6 edge grid" above). 7a7a: PREFLIGHT_PHASE_D_TAIL_LAB=1|full → scripts/perf/run-preflight-phase-d-tail-lab.sh (EXPLAIN + listings/analytics/dual k6). Optional 7a7b: PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1 → k6-messaging-limit-finder.js. 7a8: Playwright full edge suite (23 tests / 10 specs / 5 projects; 22 executed by default) via run-playwright-e2e-preflight.sh.
#   7b    Transport-layer study experiments (UDP drops, QUIC cwnd, BBR, NodePort, Caddy native, in-cluster k6). TRANSPORT_STUDY=1.
#   7c    In-cluster k6 (Pod → Caddy ClusterIP; no host/VM). RUN_K6=1 and RUN_K6_IN_CLUSTER=1 (default). K6_IN_CLUSTER_DURATION=30s. Set RUN_K6_IN_CLUSTER=0 to skip.
#   8     All 7 housing pgbench sweeps (ports 5441–5447; media 5448 optional), EXPLAIN, observation-deck summary. RUN_PGBENCH=1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

# Dev CA for k6 / Phase D / edge TLS tools: default to repo bundle when unset (override with SSL_CERT_FILE=...).
if [[ -z "${SSL_CERT_FILE:-}" ]] && [[ -s "$REPO_ROOT/certs/dev-root.pem" ]]; then
  export SSL_CERT_FILE="$REPO_ROOT/certs/dev-root.pem"
fi
if [[ -n "${SSL_CERT_FILE:-}" ]]; then
  export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
  export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"
fi

# Single artifact directory for this preflight process (logs, telemetry, k6 snapshots, phase-d, suite logs, pgbench).
# Override with PREFLIGHT_RUN_DIR=/path or PREFLIGHT_RUN_STAMP=YYYYMMDD-HHMMSS (folder becomes bench_logs/run-$STAMP).
PREFLIGHT_RUN_STAMP="${PREFLIGHT_RUN_STAMP:-$(date +%Y%m%d-%H%M%S)}"
export PREFLIGHT_RUN_DIR="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs/run-$PREFLIGHT_RUN_STAMP}"
mkdir -p "$PREFLIGHT_RUN_DIR"
export PREFLIGHT_RUN_STAMP

# Steady-state preflight: skip full CA reissue unless PREFLIGHT_REISSUE_CA=1 or cluster TLS secrets are missing.
PREFLIGHT_REISSUE_CA="${PREFLIGHT_REISSUE_CA:-0}"
export PREFLIGHT_REISSUE_CA

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@"; }

# Curl robustness under load: avoid exit 28 (timeout) by using longer max-time and connect-timeout (see bench_logs/preflight-* analysis).
export CURL_MAX_TIME="${CURL_MAX_TIME:-15}"
export CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-3}"
# Baseline HTTP/3: give QUIC time to establish (host→LB IP); retries avoid transient failure (exit 28).
export BASELINE_H3_PROBE_MAX_TIME="${BASELINE_H3_PROBE_MAX_TIME:-25}"
export BASELINE_H3_PROBE_CONNECT="${BASELINE_H3_PROBE_CONNECT:-8}"
export BASELINE_H3_PROBE_RETRIES="${BASELINE_H3_PROBE_RETRIES:-3}"
export BASELINE_H3_PROBE_SLEEP="${BASELINE_H3_PROBE_SLEEP:-5}"
export BASELINE_H3_VERIFY_MAX_TIME="${BASELINE_H3_VERIFY_MAX_TIME:-25}"
export BASELINE_H3_VERIFY_RETRIES="${BASELINE_H3_VERIFY_RETRIES:-3}"
export BASELINE_H3_VERIFY_SLEEP="${BASELINE_H3_VERIFY_SLEEP:-5}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "ℹ️  $*"; }

_ensure_first_time_local_cert_assets() {
  local certs_dir="$REPO_ROOT/certs"
  local missing_core=()
  local missing_kafka=()
  local core_files=(
    "$certs_dir/dev-root.pem"
    "$certs_dir/dev-root.key"
    "$certs_dir/off-campus-housing.test.crt"
    "$certs_dir/off-campus-housing.test.key"
  )
  local kafka_files=(
    "$certs_dir/kafka-ssl/kafka.keystore.jks"
    "$certs_dir/kafka-ssl/kafka.truststore.jks"
    "$certs_dir/kafka-ssl/kafka.keystore-password"
    "$certs_dir/kafka-ssl/kafka.truststore-password"
    "$certs_dir/kafka-ssl/kafka.key-password"
    "$certs_dir/kafka-ssl/ca-cert.pem"
  )
  local f
  for f in "${core_files[@]}"; do
    [[ -s "$f" ]] || missing_core+=("$f")
  done
  for f in "${kafka_files[@]}"; do
    [[ -s "$f" ]] || missing_kafka+=("$f")
  done
  if [[ ${#missing_core[@]} -eq 0 && ${#missing_kafka[@]} -eq 0 ]]; then
    ok "Local cert/JKS assets present (dev-root + leaf + kafka-ssl)"
    return 0
  fi

  say "0a. First-time local cert/JKS bootstrap (auto)..."
  warn "Missing local cert assets detected. Attempting auto-generate via scripts/dev-generate-certs.sh"
  if [[ -f "$SCRIPT_DIR/dev-generate-certs.sh" ]]; then
    chmod +x "$SCRIPT_DIR/dev-generate-certs.sh" 2>/dev/null || true
    "$SCRIPT_DIR/dev-generate-certs.sh" || warn "dev-generate-certs.sh failed; continuing checks"
  else
    warn "dev-generate-certs.sh not found; cannot auto-generate local certs"
  fi

  missing_core=()
  missing_kafka=()
  for f in "${core_files[@]}"; do
    [[ -s "$f" ]] || missing_core+=("$f")
  done
  for f in "${kafka_files[@]}"; do
    [[ -s "$f" ]] || missing_kafka+=("$f")
  done

  if [[ ${#missing_core[@]} -gt 0 ]]; then
    echo "❌ Missing required local cert files after bootstrap:"
    printf "   - %s\n" "${missing_core[@]}"
    echo "   Fix: run ./scripts/dev-generate-certs.sh (or pnpm run reissue), then rerun preflight."
    exit 1
  fi

  if [[ ${#missing_kafka[@]} -gt 0 ]] && command -v keytool >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
    warn "Kafka JKS still missing; attempting refresh via kafka-ssl-from-dev-root.sh"
    chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null || true
    "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" || warn "kafka-ssl-from-dev-root.sh failed; will continue and re-check later in step 3b"
  fi
}

# Full control-plane run: pgbench (all DBs, deep) + k6 + all test suites. Default on so one command runs everything.
# Pass RUN_PGBENCH=0 to run everything up to but not including step 8 (pgbench); output is still teed to PREFLIGHT_MAIN_LOG.
RUN_FULL_LOAD="${RUN_FULL_LOAD:-0}"
if [[ "${RUN_FULL_LOAD}" == "1" ]]; then
  export RUN_K6=1
  [[ "${RUN_PGBENCH:-1}" != "0" ]] && export RUN_PGBENCH=1
  export PGBENCH_MODE="${PGBENCH_MODE:-deep}"
  # k6 multi-phase + xk6 HTTP/3 phases (read, soak, limit, max over HTTP/3). run-all-test-suites passes these to run-k6-phases.sh.
  export K6_PHASES="${K6_PHASES:-read,soak,limit,max}"
  export K6_HTTP3="${K6_HTTP3:-1}"
  export K6_HTTP3_PHASES="${K6_HTTP3_PHASES:-1}"
  export K6_PROTOCOL_COMPARISON="${K6_PROTOCOL_COMPARISON:-1}"
  export K6_MAX_RPS_NO_ERRORS="${K6_MAX_RPS_NO_ERRORS:-1}"
  say "Full control plane: pgbench (all DBs, deep) + k6 + xk6 HTTP/3 phases + protocol comparison (HTTP/2 vs HTTP/3) + max RPS no-error (5 charts) + all suites (auth, baseline, enhanced, adversarial, rotation, standalone, tls-mtls, social)"
fi

# Phase-gated preflight (control-plane stabilization). See docs/PREFLIGHT_PHASED_PLAN_20260207.md
PREFLIGHT_PHASE="${PREFLIGHT_PHASE:-full}"
PREFLIGHT_PHASE0="${PREFLIGHT_PHASE0:-0}"
METALLB_ENABLED="${METALLB_ENABLED:-0}"
APPLY_RATE_LIMIT_SLEEP="${APPLY_RATE_LIMIT_SLEEP:-2}"
# App deployment scope for scale + wait-for-ready + image checks (see header).
PREFLIGHT_APP_SCOPE="${PREFLIGHT_APP_SCOPE:-full}"
APP_DEPLOYS_FULL="auth-service api-gateway listings-service booking-service messaging-service trust-service analytics-service media-service notification-service"
APP_DEPLOYS_CORE="auth-service api-gateway messaging-service media-service"
if [[ -n "${PREFLIGHT_APP_DEPLOYS:-}" ]]; then
  :
elif [[ "$PREFLIGHT_APP_SCOPE" == "core" ]]; then
  PREFLIGHT_APP_DEPLOYS="$APP_DEPLOYS_CORE"
else
  PREFLIGHT_APP_DEPLOYS="$APP_DEPLOYS_FULL"
fi
export PREFLIGHT_APP_DEPLOYS
export WAIT_APP_SERVICES="$PREFLIGHT_APP_DEPLOYS"
RUN_MESSAGING_LOAD="${RUN_MESSAGING_LOAD:-1}"
# Issues 9 & 10 Phase D lab after k6 edge grid (see scripts/perf/run-preflight-phase-d-tail-lab.sh). Default full; set PREFLIGHT_PHASE_D_TAIL_LAB=0 to skip.
PREFLIGHT_PHASE_D_TAIL_LAB="${PREFLIGHT_PHASE_D_TAIL_LAB:-full}"
# Phase 5 guardrail: write-rate limiter must be at least 1s
[[ "$APPLY_RATE_LIMIT_SLEEP" -lt 1 ]] 2>/dev/null && APPLY_RATE_LIMIT_SLEEP=1
PREFLIGHT_ABORT_ON_503="${PREFLIGHT_ABORT_ON_503:-1}"
# Write lock disabled by default (no flock/mkdir). Set PREFLIGHT_WRITE_LOCK_FILE=/tmp/preflight-write.lock to re-enable (e.g. multiple preflights).
PREFLIGHT_WRITE_LOCK_FILE="${PREFLIGHT_WRITE_LOCK_FILE:-}"
PREFLIGHT_LOCK_TIMEOUT="${PREFLIGHT_LOCK_TIMEOUT:-60}"
PREFLIGHT_SKIP_WRITE_LOCK="${PREFLIGHT_SKIP_WRITE_LOCK:-0}"
[[ "${PREFLIGHT_SKIP_WRITE_LOCK:-0}" == "1" ]] && PREFLIGHT_WRITE_LOCK_FILE=""
PREFLIGHT_USE_MKDIR_LOCK="${PREFLIGHT_USE_MKDIR_LOCK:-0}"
if [[ -n "${PREFLIGHT_WRITE_LOCK_FILE:-}" ]] && ! command -v flock >/dev/null 2>&1; then
  PREFLIGHT_USE_MKDIR_LOCK=1
fi
if [[ "$PREFLIGHT_PHASE0" == "1" ]]; then
  RUN_FULL_LOAD=0
  METALLB_ENABLED=0
fi
if [[ "$PREFLIGHT_PHASE" != "full" ]]; then
  PREFLIGHT_ABORT_ON_SLOW_APPLY="${PREFLIGHT_ABORT_ON_SLOW_APPLY:-1}"
else
  PREFLIGHT_ABORT_ON_SLOW_APPLY="${PREFLIGHT_ABORT_ON_SLOW_APPLY:-0}"
fi
# Tee entire preflight output to one log file for full-run analysis (inside PREFLIGHT_RUN_DIR by default).
# Set PREFLIGHT_MAIN_LOG= to disable (empty string); or set a custom path.
PREFLIGHT_MAIN_LOG="${PREFLIGHT_MAIN_LOG:-$PREFLIGHT_RUN_DIR/preflight-full.log}"
if [[ -n "$PREFLIGHT_MAIN_LOG" ]]; then
  mkdir -p "$(dirname "$PREFLIGHT_MAIN_LOG")" 2>/dev/null || true
  exec > >(tee "$PREFLIGHT_MAIN_LOG") 2>&1
  echo "Preflight output logging to: $PREFLIGHT_MAIN_LOG"
fi
echo "Preflight run directory (artifacts): $PREFLIGHT_RUN_DIR"
info "PREFLIGHT_RUN_DIR=$PREFLIGHT_RUN_DIR (preflight-full.log, telemetry, k6 snapshots, phase-d, suite logs, pgbench)"
info "PREFLIGHT_APP_SCOPE=${PREFLIGHT_APP_SCOPE:-full} — scale/wait targets: $PREFLIGHT_APP_DEPLOYS"
info "RUN_MESSAGING_LOAD=${RUN_MESSAGING_LOAD:-1} (k6 messaging/media health after suites, if k6 installed)"
info "PREFLIGHT_PHASE_D_TAIL_LAB=${PREFLIGHT_PHASE_D_TAIL_LAB:-full} (default full = Phase D + cross-service isolation; 0 = skip)"

# Telemetry: capture control-plane pressure during run and post-run snapshot (same as run-preflight-with-telemetry.sh).
# Set PREFLIGHT_TELEMETRY=0 to disable. TELEMETRY_PERF=1 / TELEMETRY_HTOP=1 for optional perf/htop.
PREFLIGHT_TELEMETRY="${PREFLIGHT_TELEMETRY:-1}"
TELEMETRY_LOOP_PID=""
TELEMETRY_PERF_PID=""
TELEMETRY_TS=""
TELEMETRY_DURING=""
TELEMETRY_AFTER=""
TELEMETRY_RAW_METRICS=""
TELEMETRY_PERF_DATA=""
_preflight_telemetry_on_exit() {
  if [[ "${PREFLIGHT_TELEMETRY:-0}" != "1" ]] || [[ -z "$TELEMETRY_TS" ]]; then return; fi
  [[ -n "$TELEMETRY_LOOP_PID" ]] && kill "$TELEMETRY_LOOP_PID" 2>/dev/null || true
  [[ -n "$TELEMETRY_LOOP_PID" ]] && wait "$TELEMETRY_LOOP_PID" 2>/dev/null || true
  [[ -n "$TELEMETRY_PERF_PID" ]] && kill "$TELEMETRY_PERF_PID" 2>/dev/null || true
  [[ -n "$TELEMETRY_PERF_PID" ]] && wait "$TELEMETRY_PERF_PID" 2>/dev/null || true
  echo ""
  echo "=== Preflight telemetry (post-run) ==="
  [[ -f "$SCRIPT_DIR/capture-control-plane-telemetry.sh" ]] && "$SCRIPT_DIR/capture-control-plane-telemetry.sh" --once > "$TELEMETRY_AFTER" 2>&1 || true
  kubectl get --raw /metrics --request-timeout=15s > "$TELEMETRY_RAW_METRICS" 2>/dev/null || echo "(raw metrics unavailable)" > "$TELEMETRY_RAW_METRICS"
  if [[ "${TELEMETRY_HTOP:-0}" == "1" ]] && command -v htop >/dev/null 2>&1; then
    HTOP_SNAP="$PREFLIGHT_RUN_DIR/htop-after.txt"
    htop --batch --delay=1 2>/dev/null | head -100 > "$HTOP_SNAP" || true
    echo "TELEMETRY_HTOP_SNAPSHOT=$HTOP_SNAP"
  fi
  echo "TELEMETRY_DURING=$TELEMETRY_DURING"
  echo "TELEMETRY_AFTER=$TELEMETRY_AFTER"
  echo "TELEMETRY_RAW_METRICS=$TELEMETRY_RAW_METRICS"
  [[ -n "$TELEMETRY_PERF_DATA" ]] && [[ -f "$TELEMETRY_PERF_DATA" ]] && echo "TELEMETRY_PERF_DATA=$TELEMETRY_PERF_DATA (perf report -i $TELEMETRY_PERF_DATA)"
  [[ -n "${PREFLIGHT_RUN_DIR:-}" ]] && [[ -f "${TELEMETRY_LIVE_CSV:-$REPO_ROOT/live-telemetry.csv}" ]] && cp -f "${TELEMETRY_LIVE_CSV:-$REPO_ROOT/live-telemetry.csv}" "$PREFLIGHT_RUN_DIR/live-telemetry.csv" 2>/dev/null || true
}
if [[ "$PREFLIGHT_TELEMETRY" == "1" ]]; then
  TELEMETRY_TS="$PREFLIGHT_RUN_STAMP"
  TELEMETRY_DURING="$PREFLIGHT_RUN_DIR/telemetry-during.log"
  TELEMETRY_AFTER="$PREFLIGHT_RUN_DIR/telemetry-after.txt"
  TELEMETRY_RAW_METRICS="$PREFLIGHT_RUN_DIR/raw-metrics.txt"
  # Live CSV for dashboard: fixed name at repo root so a static file server can fetch it; copy also under run dir.
  TELEMETRY_LIVE_CSV="${TELEMETRY_LIVE_CSV:-$REPO_ROOT/live-telemetry.csv}"
  [[ "${TELEMETRY_PERF:-0}" == "1" ]] && TELEMETRY_PERF_DATA="$PREFLIGHT_RUN_DIR/perf.data"
  trap 'e=$?; _preflight_telemetry_on_exit; exit $e' EXIT
  : > "$TELEMETRY_DURING"
  # Telemetry loop is started after step 0 (kill stale) so it is never mistaken for a stale process.
fi

_phase_a_only()  { [[ "$PREFLIGHT_PHASE" == "A" ]]; }
_phase_a_or_full() { [[ "$PREFLIGHT_PHASE" == "A" ]] || [[ "$PREFLIGHT_PHASE" == "full" ]]; }
_phase_b_only()  { [[ "$PREFLIGHT_PHASE" == "B" ]]; }
_phase_c_only()  { [[ "$PREFLIGHT_PHASE" == "C" ]]; }
_phase_d_only()  { [[ "$PREFLIGHT_PHASE" == "D" ]]; }

# Rate-limited apply: sleep between batches; abort if apply exceeds 10s when PREFLIGHT_ABORT_ON_SLOW_APPLY=1
_apply_with_rate_limit() {
  local dir_or_file="$1" name="${2:-$(basename "$dir_or_file")}" r=0
  if [[ "${PREFLIGHT_ABORT_ON_SLOW_APPLY:-0}" == "1" ]]; then
    timeout 10 kubectl apply -k "$dir_or_file" --request-timeout=20s 2>/dev/null || r=$?
    [[ $r -eq 124 ]] && { echo "❌ ABORT: kubectl apply took >10s (control-plane overload). Phase: $PREFLIGHT_PHASE" >&2; exit 1; }
    [[ $r -ne 0 ]] && { warn "Apply $name failed"; return 1; }
  else
    kubectl apply -k "$dir_or_file" --request-timeout=20s 2>/dev/null || { warn "Apply $name failed"; return 1; }
  fi
  sleep "${APPLY_RATE_LIMIT_SLEEP:-2}"
}
_apply_file_with_rate_limit() {
  local f="$1" name="${2:-$(basename "$f")}" r=0
  if [[ "${PREFLIGHT_ABORT_ON_SLOW_APPLY:-0}" == "1" ]]; then
    timeout 10 kubectl apply -f "$f" --request-timeout=20s 2>/dev/null || r=$?
    [[ $r -eq 124 ]] && { echo "❌ ABORT: kubectl apply $name took >10s (control-plane overload). Phase: $PREFLIGHT_PHASE" >&2; exit 1; }
    [[ $r -ne 0 ]] && { warn "Apply $name failed"; return 1; }
  else
    kubectl apply -f "$f" --request-timeout=20s 2>/dev/null || { warn "Apply $name failed"; return 1; }
  fi
  sleep "${APPLY_RATE_LIMIT_SLEEP:-2}"
}

# Apply each housing microservice under infra/k8s/base/<name> so Deployments exist before scale (e.g. notification-service).
_apply_housing_app_bases() {
  local _svc _kd
  for _svc in $PREFLIGHT_APP_DEPLOYS; do
    _kd="$REPO_ROOT/infra/k8s/base/$_svc"
    if [[ -d "$_kd" ]] && [[ -f "$_kd/kustomization.yaml" ]]; then
      _apply_with_rate_limit "$_kd" "housing-$_svc" && ok "Applied housing base: $_svc" || warn "Apply housing base $_svc failed"
    fi
  done
}

# Phase timing: append to TELEMETRY_DURING so we can see which step took long (gaps between phase_ts = slow step).
_phase_start() {
  local name="${1:-unknown}"
  if [[ "${PREFLIGHT_TELEMETRY:-0}" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]] && [[ -w "${TELEMETRY_DURING:-}" ]]; then
    echo "phase=$name start_ts=$(date +%s) iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$TELEMETRY_DURING"
  fi
}

# Timestamp start for tracking how long steps take (grep phase= in TELEMETRY_DURING or telemetry log).
_PREFLIGHT_START_TS=$(date +%s)
_PREFLIGHT_START_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
say "=== Pre-test: Scale, TLS, DB/Redis, then All Suites ==="
[[ "${PREFLIGHT_TELEMETRY:-0}" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]] && echo "phase=preflight_start start_ts=$_PREFLIGHT_START_TS iso=$_PREFLIGHT_START_ISO" >> "$TELEMETRY_DURING" 2>/dev/null || true
info "Preflight started at $_PREFLIGHT_START_ISO (step timings: grep '^phase=' in telemetry log)"
if [[ "$PREFLIGHT_PHASE" != "full" ]]; then
  info "PREFLIGHT_PHASE=$PREFLIGHT_PHASE METALLB_ENABLED=$METALLB_ENABLED APPLY_RATE_LIMIT_SLEEP=$APPLY_RATE_LIMIT_SLEEP (see docs/PREFLIGHT_PHASES_README.md)"
fi

# 0a. Optional: full Colima teardown + start (only when Colima is required and in use).
if [[ "${REQUIRE_COLIMA:-1}" == "1" ]] && [[ "${COLIMA_TEARDOWN_FIRST:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/colima-teardown-and-start.sh" ]]; then
  say "0a. Colima teardown + start (COLIMA_TEARDOWN_FIRST=1)..."
  "$SCRIPT_DIR/colima-teardown-and-start.sh" || exit 1
  ok "Colima ready (6443 tunnel); continuing with preflight."
fi

# --- Step 0: Kill stale pipeline/test processes (avoids interference from old preflight, suites, tcpdump, k6) ---
# Set KILL_STALE_FIRST=0 to skip. See scripts/find-and-kill-idle-then-run-pipeline.sh for full list of patterns.
if [[ "${KILL_STALE_FIRST:-1}" == "1" ]] && [[ -f "$SCRIPT_DIR/find-and-kill-idle-then-run-pipeline.sh" ]]; then
  _phase_start "0_kill_stale"
  say "0. Killing stale pipeline/test processes (preflight, run-all, test-microservices, tcpdump, k6, rotation, etc.)..."
  KILL=1 KILL_ONLY=1 CALLER_PID=$$ "$SCRIPT_DIR/find-and-kill-idle-then-run-pipeline.sh" 2>/dev/null && ok "Stale processes cleared" || true
  sleep 1
fi
if [[ "${DOCKER_PRUNE_STALE:-1}" != "0" ]]; then
  docker image prune -f 2>/dev/null && info "Pruned dangling Docker images" || true
  if [[ "${DOCKER_PRUNE_DEV:-0}" == "1" ]]; then
    _dev_images=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep ":dev$" || true)
    [[ -n "$_dev_images" ]] && echo "$_dev_images" | xargs docker rmi 2>/dev/null && info "Removed stale :dev images" || true
  fi
fi

# Start telemetry after step 0 (bounded loop to avoid unbounded while true and SIGKILL under load).
# TELEMETRY_MAX_DURATION: max seconds for the telemetry loop (default 480 = 8 min to avoid API saturation during long suites).
# TELEMETRY_MAX_ITERATIONS: max loop count (default 60 = 60*8s = 8 min when combined with sleep 8); set 0 for duration-only.
if [[ "$PREFLIGHT_TELEMETRY" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]]; then
  _phase_start "telemetry_start"
  _live_csv="${TELEMETRY_LIVE_CSV:-}"
  _telemetry_cap="${TELEMETRY_MAX_DURATION:-480}"
  _telemetry_max_iter="${TELEMETRY_MAX_ITERATIONS:-60}"
  _telemetry_script() {
    local _start _elapsed _iters=0
    _start=$(date +%s)
    while true; do
      _elapsed=$(($(date +%s) - _start))
      [[ "$_elapsed" -ge "$_telemetry_cap" ]] && break
      [[ "$_telemetry_max_iter" -gt 0 ]] && [[ "$_iters" -ge "$_telemetry_max_iter" ]] && break
      _iters=$((_iters + 1))
      ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
      epoch=$(date +%s)
      echo "=== $ts ===" >> "$TELEMETRY_DURING"
      raw_metrics=$(kubectl get --raw /metrics --request-timeout=5s 2>/dev/null | grep -E '^apiserver_current_inflight|^apiserver_request_duration_seconds_(count|sum)' || true)
      echo "$raw_metrics" >> "$TELEMETRY_DURING"
      [[ -z "$raw_metrics" ]] && echo "(metrics unavailable)" >> "$TELEMETRY_DURING"
      if [[ -n "$_live_csv" ]]; then
        inflight=$(echo "$raw_metrics" | awk '/^apiserver_current_inflight_requests/ {sum+=$NF} END {print sum+0}')
        req_count=$(echo "$raw_metrics" | awk '/^apiserver_request_duration_seconds_count/ {sum+=$NF} END {print sum+0}')
        node_ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2=="Ready" {c++} END {print c+0}' || echo "0")
        node_total=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' \n\r')
        node_ready=${node_ready//[!0-9]/}; node_ready=${node_ready:-0}
        node_total=${node_total//[!0-9]/}; node_total=${node_total:-0}
        node_not_ready=$((node_total - node_ready))
        [[ -s "$_live_csv" ]] || echo "iso_ts,epoch_ts,inflight_requests,request_count,node_ready,node_not_ready" >> "$_live_csv"
        echo "$ts,$epoch,$inflight,$req_count,$node_ready,$node_not_ready" >> "$_live_csv"
      fi
      sleep 8
    done
  }
  ( _telemetry_script ) &
  TELEMETRY_LOOP_PID=$!
  if [[ -n "${TELEMETRY_PERF_DATA:-}" ]] && command -v perf >/dev/null 2>&1; then
    perf record -o "$TELEMETRY_PERF_DATA" -g -a 2>/dev/null &
    TELEMETRY_PERF_PID=$!
  fi
  info "Telemetry: during-run → $TELEMETRY_DURING; post-run → $TELEMETRY_AFTER, $TELEMETRY_RAW_METRICS"
  info "  Live CSV (API workload + node sitrep): ${TELEMETRY_LIVE_CSV:-$REPO_ROOT/live-telemetry-*.csv} — open scripts/live-preflight-dashboard.html and point to this file (or run: python -m http.server 8888 and open http://localhost:8888/scripts/live-preflight-dashboard.html)"
  info "  Phase timing: grep '^phase=' $TELEMETRY_DURING to see step start_ts; large gaps = slow step."
  info "  Workload chart: scripts/telemetry-to-chart-csv.sh $TELEMETRY_DURING → CSV for line chart (inflight_requests, request_count)."
fi

# --- Step 1: Context (Colima or k3d), no Kind; merge kubeconfig, trim pods, preflight kubeconfig ---
# Colima + k3s only (no Kind). Use API reachability as source of truth (colima status can say "not running" when it is).
# When METALLB_VERIFY_COLIMA_L2=1: we run preflight on k3d and only switch to Colima for step 3c1c (MetalLB L2/BGP verification). Do NOT force REQUIRE_COLIMA=1 so user can pass REQUIRE_COLIMA=0.
# When METALLB_ENABLED=1: prefer Colima so LB IP is reachable and HTTP/3 works without socat. Pass REQUIRE_COLIMA=0 (or METALLB_USE_K3D=1) to use k3d with MetalLB (socat path).
# Default k3d so preflight and suites run on k3d; Colima used only for step 3c1c (MetalLB L2 verification) when METALLB_VERIFY_COLIMA_L2=1.
REQUIRE_COLIMA="${REQUIRE_COLIMA:-0}"
[[ "${METALLB_ENABLED:-0}" == "1" ]] && [[ "${REQUIRE_COLIMA:-0}" != "0" ]] && [[ "${METALLB_USE_K3D:-0}" != "1" ]] && REQUIRE_COLIMA=1
ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "${REQUIRE_COLIMA:-1}" == "1" ]]; then
  colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
  # When Colima is already running, its context may only exist in Colima's kubeconfig; merge it first so we can switch without starting Colima
  if [[ -z "$colima_ctx" ]]; then
    colima_kube=""
    for cand in "$HOME/.colima/default/kubernetes/kubeconfig" "$HOME/.colima/default/kubeconfig"; do
      if [[ -s "$cand" ]]; then colima_kube="$cand"; break; fi
    done
    if [[ -z "$colima_kube" ]] && command -v colima >/dev/null 2>&1; then
      profile=$(colima status 2>/dev/null | awk '/profile:/{print $2}' || echo "default")
      for cand in "$HOME/.colima/${profile}/kubernetes/kubeconfig" "$HOME/.colima/${profile}/kubeconfig"; do
        if [[ -s "$cand" ]]; then colima_kube="$cand"; break; fi
      done
    fi
    if [[ -n "$colima_kube" ]]; then
      export KUBECONFIG="${colima_kube}:${KUBECONFIG:-$HOME/.kube/config}"
      colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
      if [[ -z "$colima_ctx" ]]; then
        colima_ctx=$(KUBECONFIG="$colima_kube" kubectl config current-context 2>/dev/null || echo "")
      fi
    fi
  fi
  if [[ -n "$colima_ctx" ]]; then
    kubectl config use-context "$colima_ctx" 2>/dev/null && ctx="$colima_ctx" || true
  elif command -v colima >/dev/null 2>&1 && [[ "${COLIMA_START:-1}" == "1" ]]; then
    say "No Colima context found; starting Colima (colima start --with-kubernetes)..."
    colima start --with-kubernetes 2>&1 || true
    sleep 3
    colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
    if [[ -z "$colima_ctx" ]]; then
      for cand in "$HOME/.colima/default/kubernetes/kubeconfig" "$HOME/.colima/default/kubeconfig"; do
        if [[ -s "$cand" ]]; then
          export KUBECONFIG="${cand}:${KUBECONFIG:-$HOME/.kube/config}"
          colima_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1 || echo "")
          [[ -z "$colima_ctx" ]] && colima_ctx=$(KUBECONFIG="$cand" kubectl config current-context 2>/dev/null || echo "")
          break
        fi
      done
    fi
    [[ -n "$colima_ctx" ]] && kubectl config use-context "$colima_ctx" 2>/dev/null && ctx="$colima_ctx" || true
  fi
else
  # REQUIRE_COLIMA=0: wire to k3d so we never run heavy preflight/suites on Colima (control plane stays stable)
  k3d_ctx=$(kubectl config get-contexts -o name 2>/dev/null | grep -E '^k3d-' | head -1 || echo "")
  if [[ -n "$k3d_ctx" ]]; then
    kubectl config use-context "$k3d_ctx" 2>/dev/null && ctx="$k3d_ctx" || true
  fi
  # If no k3d context, keep current (e.g. user has only one cluster); guardrail below will reject kind/h3
fi
# Guardrail: no Kind clusters. When REQUIRE_COLIMA=0 (e.g. k3d), allow any context except kind/h3.
if [[ "$ctx" == *"kind"* ]] || [[ "$ctx" == "h3" ]]; then
  echo "❌ Kind/h3 clusters are not supported. Current context: $ctx"
  echo "   Use k3d (REQUIRE_COLIMA=0) or Colima + k3s (REQUIRE_COLIMA=1)."
  exit 1
fi
if [[ "${REQUIRE_COLIMA:-1}" == "1" ]] && [[ "$ctx" != *"colima"* ]]; then
  echo "❌ Colima + k3s required (REQUIRE_COLIMA=1). Current context: $ctx"
  echo "   Run: colima start --with-kubernetes && kubectl config use-context colima"
  echo "   Or run with REQUIRE_COLIMA=0 to use k3d (e.g. METALLB_ENABLED=1 REQUIRE_COLIMA=0 for MetalLB on k3d)."
  exit 1
fi
if [[ "$ctx" == *"colima"* ]]; then
  if [[ -s "$HOME/.colima/default/kubernetes/kubeconfig" ]]; then
    export KUBECONFIG="$HOME/.colima/default/kubernetes/kubeconfig"
  fi
  # Ensure 127.0.0.1:6443 is reachable (tunnel host 6443 -> guest k3s port if needed)
  if [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
    "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
  fi
  # Pin kubeconfig to 6443 in this process so kubectl get nodes uses the tunnel (forward script runs in subprocess and may write to different file, or Colima can overwrite).
  if nc -z 127.0.0.1 6443 2>/dev/null && [[ "$ctx" == *"colima"* ]]; then
    _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
  fi
  api_ok=0
  if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    api_ok=1
  fi
  if [[ $api_ok -eq 0 ]] && nc -z 127.0.0.1 6443 2>/dev/null; then
    # 6443 is open but kubectl failed — retry after re-pinning (TLS or cache)
    _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
    sleep 2
    if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
      api_ok=1
    fi
  fi
  if [[ $api_ok -eq 0 ]] && command -v colima >/dev/null 2>&1; then
    if [[ "${COLIMA_START:-1}" == "1" ]]; then
      say "API server not reachable; ensuring Colima is up (COLIMA_START=1)..."
      # Fix kubeconfig to 127.0.0.1:6443 before waiting (same as step 2, so we hit the right endpoint)
      if [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]]; then
        echo "  Fixing kubeconfig server to 127.0.0.1:6443..."
        PREFLIGHT_CAP=20 "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || true
      fi
      echo "  Running: colima start --with-kubernetes (timeout 120s)..."
      colima start --with-kubernetes 2>&1 &
      colima_pid=$!
      ( sleep 120; kill $colima_pid 2>/dev/null ) & kill_pid=$!
      wait $colima_pid 2>/dev/null || true
      kill $kill_pid 2>/dev/null || true
      wait $kill_pid 2>/dev/null || true
      # Require host-side 127.0.0.1:6443 (kubectl apply, port-forward need it). colima ssh is not enough.
      for i in $(seq 1 24); do
        echo "  Waiting for API server at 127.0.0.1:6443 (attempt $i/24)..."
        if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
          api_ok=1
          break
        fi
        [[ $i -lt 24 ]] && sleep 5
      done
      if [[ $api_ok -eq 1 ]]; then
        ok "API server reachable (127.0.0.1:6443)"
      else
        echo "❌ API server at 127.0.0.1:6443 not reachable after 2 minutes."
        echo "  Port 6443: $(nc -z 127.0.0.1 6443 2>&1 && echo 'open' || echo 'closed/unreachable')"
        command -v colima >/dev/null 2>&1 && echo "  colima status:" && colima status 2>&1 | sed 's/^/    /' || true
        echo ""
        echo "  Fix: Run the 6443 tunnel script, then retry:"
        echo "    ./scripts/colima-forward-6443.sh"
        echo "    nc -z 127.0.0.1 6443 && kubectl get nodes"
        exit 1
      fi
    else
      echo "❌ API server not reachable (Colima may be stopped or slow)."
      echo "   Option 1: Teardown and fresh start: ./scripts/colima-teardown-and-start.sh  then re-run this script"
      echo "   Option 2: colima start --with-kubernetes  then ./scripts/colima-forward-6443.sh  then re-run"
      echo "   Option 3: Re-run with COLIMA_START=1 (default) so this script starts Colima and waits for 6443"
      exit 1
    fi
  elif [[ $api_ok -eq 1 ]]; then
    ok "Context: Colima + k3s ($ctx); API server reachable"
  else
    # API not reachable and colima not in PATH (can't auto-start)
    echo "❌ API server not reachable and colima not in PATH. Start Colima, then re-run."
    exit 1
  fi
else
  if [[ "${REQUIRE_COLIMA}" == "1" ]]; then
    echo "❌ Colima + k3s required. Current: $ctx. Run: colima start --with-kubernetes, then re-run."
    exit 1
  fi
  info "Context: $ctx — using k3d for preflight (Colima control plane not used for heavy steps). Set METALLB_VERIFY_COLIMA_L2=1 to run L2 (ARP/asymmetric) on Colima only."
fi

# Helper: set _colima_ctx_for_metallb in current shell and merge Colima kubeconfig when needed. Call without $() so KUBECONFIG merge applies. Used only for step 3c1c (MetalLB real L2 on Colima k3s).
_get_colima_context_for_metallb() {
  _colima_ctx_for_metallb=""
  # 1) Already in kubeconfig and name looks like Colima
  _colima_ctx_for_metallb=$(kubectl config get-contexts -o name 2>/dev/null | grep -iE 'colima|colima-default' | head -1 || echo "")
  if [[ -n "$_colima_ctx_for_metallb" ]]; then
    return
  fi
  local colima_kube="" cand profile
  # 2) Find Colima kubeconfig (may not be in KUBECONFIG when current context is k3d)
  for cand in "$HOME/.colima/default/kubernetes/kubeconfig" "$HOME/.colima/default/kubeconfig"; do
    if [[ -s "$cand" ]]; then colima_kube="$cand"; break; fi
  done
  if [[ -z "$colima_kube" ]] && command -v colima >/dev/null 2>&1; then
    profile=$(colima status 2>/dev/null | awk '/profile:/{print $2}' || echo "default")
    for cand in "$HOME/.colima/${profile}/kubernetes/kubeconfig" "$HOME/.colima/${profile}/kubeconfig"; do
      if [[ -s "$cand" ]]; then colima_kube="$cand"; break; fi
    done
  fi
  if [[ -n "$colima_kube" ]]; then
    export KUBECONFIG="${colima_kube}:${KUBECONFIG:-$HOME/.kube/config}"
    _colima_ctx_for_metallb=$(kubectl config get-contexts -o name 2>/dev/null | grep -iE 'colima|colima-default' | head -1 || echo "")
    if [[ -z "$_colima_ctx_for_metallb" ]]; then
      _colima_ctx_for_metallb=$(KUBECONFIG="$colima_kube" kubectl config current-context 2>/dev/null || echo "")
    fi
    if [[ -z "$_colima_ctx_for_metallb" ]]; then
      _colima_ctx_for_metallb=$(KUBECONFIG="$colima_kube" kubectl config get-contexts -o name 2>/dev/null | head -1 || echo "")
    fi
  fi
}

# 1b. Re-verify API and tunnel so step 2/3 don't see flaky 503 (ensure-k8s-api: retries + re-forward 6443).
if [[ "$ctx" == *"colima"* ]] && [[ -x "$SCRIPT_DIR/ensure-k8s-api.sh" ]]; then
  "$SCRIPT_DIR/ensure-k8s-api.sh" || exit 1
fi

# 1c. First-time bootstrap guard: ensure local CA/leaf + kafka JKS files exist before cert-dependent steps.
_ensure_first_time_local_cert_assets

# 1. Trim completed pods first (reduces API server load; no-op if cluster down)
_phase_start "1_trim"
say "1. Trim completed pods (reduce API load / bloat)..."
if [[ -f "$SCRIPT_DIR/trim-completed-pods.sh" ]]; then
  TRIM_CAP=10 "$SCRIPT_DIR/trim-completed-pods.sh" 2>/dev/null && ok "Trimmed completed pods" || true
fi

# --- Step 2: Preflight kubeconfig (Colima 127.0.0.1:6443; single-cluster). PREFLIGHT_CAP=30 ---
# Pin to 6443 before preflight so step 2 doesn't try native port (which can be unreachable).
if [[ "$ctx" == *"colima"* ]] && nc -z 127.0.0.1 6443 2>/dev/null; then
  _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
  kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
fi
_phase_start "2_preflight_kubeconfig"
say "2. Preflight kubeconfig..."
PREFLIGHT_OK=0
PREFLIGHT_CAP="${PREFLIGHT_CAP:-30}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null && PREFLIGHT_OK=1 || warn "Preflight had issues; continuing."

if [[ "$PREFLIGHT_OK" == "1" ]] && [[ -f "$SCRIPT_DIR/trim-completed-pods.sh" ]]; then
  TRIM_CAP=10 "$SCRIPT_DIR/trim-completed-pods.sh" 2>/dev/null && ok "Trimmed again (post-preflight)" || true
fi

# 2b. Cluster hygiene: only slim ~/.kube/config (never Colima's — overwriting Colima's broke API server after pgbench/data load)
# get-clusters prints a "NAME" header; exclude it so we only run clean when there are really 2+ clusters
if [[ -f "$SCRIPT_DIR/clean-unused-kubeconfig.sh" ]] && [[ -s "$HOME/.kube/config" ]]; then
  cluster_count=$(KUBECONFIG="$HOME/.kube/config" kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' | grep -c . || echo "0")
  if [[ "$cluster_count" -gt 1 ]]; then
    say "2b. Cleaning unused kubeconfig in ~/.kube/config (had $cluster_count clusters)..."
    KUBECONFIG="$HOME/.kube/config" "$SCRIPT_DIR/clean-unused-kubeconfig.sh" 2>/dev/null && ok "Kubeconfig slimmed" || true
  fi
fi

# 2c. Use Colima's kubeconfig for all following steps (avoids relying on slimmed ~/.kube/config)
if [[ "$ctx" == *"colima"* ]] && [[ -s "$HOME/.colima/default/kubernetes/kubeconfig" ]]; then
  export KUBECONFIG="$HOME/.colima/default/kubernetes/kubeconfig"
  ok "Using Colima kubeconfig for API check and rest of pipeline"
fi

# 2c2. Diagnostic: what the config is pointed at (context, clusters, servers). Expect one cluster (colima k3s).
# Note: kubectl config get-clusters prints a "NAME" header line, so we exclude it when counting.
if [[ "$ctx" == *"colima"* ]]; then
  _cfg="${KUBECONFIG:-$HOME/.kube/config}"
  _nctx=$(kubectl config get-contexts -o name 2>/dev/null | wc -l | tr -d ' ')
  _clusters_raw=$(kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' || true)
  _ncl=$(echo "$_clusters_raw" | grep -c . || echo "0")
  info "Kubeconfig: $_cfg (contexts: $_nctx, clusters: $_ncl)"
  if [[ "${_ncl}" -gt 1 ]] || [[ "${_ncl}" -eq 0 ]]; then
    warn "Expected 1 cluster (colima k3s); found $_ncl. Cluster names: $(echo "$_clusters_raw" | tr '\n' ' ')"
  fi
  # List every cluster and its server (by index)
  _i=0
  while true; do
    _name=$(kubectl config view -o jsonpath="{.clusters[$_i].name}" 2>/dev/null || true)
    _server=$(kubectl config view -o jsonpath="{.clusters[$_i].cluster.server}" 2>/dev/null || true)
    [[ -z "$_name" ]] && break
    info "  cluster[$_i]: $_name -> $_server"
    _i=$((_i + 1))
  done
fi

# 2d. Brief pause so API server isn't hammered immediately after config changes
sleep 5

# 2e. Colima: ensure app images exist. Listings (and other services) use :dev or off-campus-housing-tracker-*:latest per K8s deploy.
# Set PREFLIGHT_ENSURE_IMAGES=0 to skip when images already exist.
if [[ "${PREFLIGHT_ENSURE_IMAGES:-1}" == "1" ]] && [[ "$ctx" == *"colima"* ]]; then
  _phase_start "2e_colima_images"
  say "2e. Colima: ensuring app images for PREFLIGHT_APP_DEPLOYS (${PREFLIGHT_APP_DEPLOYS})..."
  KARCH=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || uname -m)
  case "$KARCH" in aarch64|arm64) PLAT="linux/arm64";; *) PLAT="linux/amd64";; esac
  read -r -a _colima_services <<< "$PREFLIGHT_APP_DEPLOYS"
  _need_build=()
  for _s in "${_colima_services[@]}"; do
    docker image inspect "${_s}:dev" &>/dev/null || _need_build+=("$_s")
  done
  if [[ ${#_need_build[@]} -gt 0 ]] && command -v docker &>/dev/null; then
    info "Building ${#_need_build[@]} missing image(s) in parallel (max 4 at a time)..."
    _max_parallel=4
    _idx=0
    while [[ $_idx -lt ${#_need_build[@]} ]]; do
      _batch=()
      for ((_i = 0; _i < _max_parallel && _idx + _i < ${#_need_build[@]}; _i++)); do
        _batch+=("${_need_build[$((_idx + _i))]}")
      done
      for _s in "${_batch[@]}"; do
        (
          if [[ -f "$REPO_ROOT/services/$_s/Dockerfile" ]]; then
            _tag="${_s}:dev"
            docker build --platform="$PLAT" -t "$_tag" -f "$REPO_ROOT/services/$_s/Dockerfile" "$REPO_ROOT" 2>/dev/null && echo "  built $_tag" || echo "  ⚠️  $_tag failed"
          fi
        ) &
      done
      wait
      _idx=$((_idx + ${#_batch[@]}))
    done
    ok "Colima app images ensured"
  else
    [[ ${#_need_build[@]} -eq 0 ]] && ok "All app images present" || info "Some images missing; set PREFLIGHT_ENSURE_IMAGES=0 to skip"
  fi
  # Build caddy-with-tcpdump and envoy-with-tcpdump if missing (so 3c2 patch + 6e never hit tcpdump install timeout)
  if [[ -f "$SCRIPT_DIR/ensure-caddy-envoy-tcpdump.sh" ]] && { ! docker image inspect caddy-with-tcpdump:dev &>/dev/null || ! docker image inspect envoy-with-tcpdump:dev &>/dev/null; }; then
    info "Building caddy-with-tcpdump and envoy-with-tcpdump (guarantee 6e skips in-pod install)..."
    SKIP_PATCH=1 bash "$SCRIPT_DIR/ensure-caddy-envoy-tcpdump.sh" 2>&1 | tail -8
  fi
fi
# 2e. k3d only: ensure required app images are in registry (fail fast before reissue/scale)
# PREFLIGHT_ENSURE_IMAGES=1 (default). Set 0 to skip (e.g. if you use image load or different registry).
# Registry 5000 can be briefly unreachable after cluster start or right after registry push; retry with initial delay.
if [[ "${PREFLIGHT_ENSURE_IMAGES:-1}" == "1" ]] && [[ "$ctx" == *"k3d"* ]]; then
  _reg_port="${REG_PORT:-5000}"
  _reg_ok=0
  # Brief delay so registry is reachable when preflight runs right after k3d-registry-push-and-patch (port bind race).
  sleep 5
  for _attempt in 1 2 3 4 5 6; do
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:$_reg_port/v2/" 2>/dev/null | grep -qE '200|401'; then
      _reg_ok=1
      break
    fi
    if [[ $_attempt -eq 1 ]] && command -v docker >/dev/null 2>&1; then
      docker start k3d-off-campus-housing-tracker-registry 2>/dev/null && sleep 2 || true
    fi
    [[ $_attempt -lt 6 ]] && sleep 3
  done
  if [[ $_reg_ok -eq 1 ]]; then
    read -r -a _required <<< "$PREFLIGHT_APP_DEPLOYS"
    _reg_missing=()
    for _s in "${_required[@]}"; do
      _code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:$_reg_port/v2/$_s/tags/list" 2>/dev/null || echo "000")
      [[ "$_code" != "200" ]] && _reg_missing+=("$_s")
    done
    if [[ ${#_reg_missing[@]} -gt 0 ]]; then
      echo "[PREFLIGHT] Required app images missing from registry (127.0.0.1:$_reg_port): ${_reg_missing[*]}" >&2
      echo "  Run: ./scripts/k3d-registry-push-and-patch.sh  (build :dev images first if needed)" >&2
      echo "  Or:  ./scripts/ensure-ready-for-preflight.sh  if available" >&2
      exit 1
    fi
    ok "Required app images present in registry (127.0.0.1:$_reg_port)"
  else
    warn "Registry (127.0.0.1:$_reg_port) not reachable after retries; skipping image check. To fix: (1) Start k3d: k3d cluster start off-campus-housing-tracker  (2) Start registry: docker start k3d-off-campus-housing-tracker-registry  (3) Push images: ./scripts/k3d-registry-push-and-patch.sh  See: ./scripts/k3d-status-and-http3-debug.sh"
  fi
fi

# Optional: stop after step 2 (for debugging; e.g. PREFLIGHT_STOP_AFTER_STEP=2)
if [[ -n "${PREFLIGHT_STOP_AFTER_STEP:-}" ]] && [[ "${PREFLIGHT_STOP_AFTER_STEP}" == "2" ]]; then
  say "PREFLIGHT_STOP_AFTER_STEP=2 — stopping after step 2 (kubeconfig + images)."
  exit 0
fi

# --- Step 3: Ensure API server ready (mandatory unless SKIP_API_SERVER_CHECK=1; k3d ENSURE_CAP=180, Colima 480) ---
# When using k3d (REQUIRE_COLIMA=0), enable K3D_AUTO_RESTART so one API failure triggers cluster restart and retry.
_do_ensure() {
  # Use default kubeconfig (~/.kube/config) so ensure's localhost fix applies to the same file preflight uses.
  # Show ensure stderr so we see _show_why_not_ready when API check fails (no 2>/dev/null).
  [[ "${REQUIRE_COLIMA:-1}" == "0" ]] && export K3D_AUTO_RESTART=1 || true
  # On k3d use shorter default ENSURE_CAP (180s) so we don't wait 8 min if API never comes up; override with ENSURE_CAP=480 if needed.
  _ensure_cap="${ENSURE_CAP:-480}"
  [[ "${REQUIRE_COLIMA:-1}" == "0" ]] && _ensure_cap="${ENSURE_CAP:-180}"
  KUBECTL_REQUEST_TIMEOUT=15s API_SERVER_MAX_ATTEMPTS=15 API_SERVER_SLEEP=3 \
    ENSURE_CAP="$_ensure_cap" PREFLIGHT_CAP=45 ATTEMPT_TIMEOUT=35 \
    TELEMETRY_DURING="${TELEMETRY_DURING:-}" TELEMETRY_AFTER="${TELEMETRY_AFTER:-}" TELEMETRY_RAW_METRICS="${TELEMETRY_RAW_METRICS:-}" \
    env KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}" "$SCRIPT_DIR/ensure-api-server-ready.sh"
  _ensure_ret=$?
  [[ "${REQUIRE_COLIMA:-1}" == "0" ]] && unset K3D_AUTO_RESTART 2>/dev/null || true
  return "$_ensure_ret"
}
if [[ "${SKIP_API_SERVER_CHECK:-0}" == "1" ]]; then
  say "3. Skipping API server check (SKIP_API_SERVER_CHECK=1)"
  warn "Proceeding without API server verification; later steps may fail."
elif [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  _phase_start "3_ensure_api"
  say "3. Ensuring API server ready..."
  # k3d: merge kubeconfig before ensure so we have current API port (avoids intermittent TLS/port issues)
  if [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
    k3d kubeconfig merge "${ctx#k3d-}" 2>/dev/null || true
  fi
  if _do_ensure; then
    ok "API server ready"
  else
    warn "API server not ready; trimming again and retrying once..."
    TRIM_CAP=10 "$SCRIPT_DIR/trim-completed-pods.sh" 2>/dev/null || true
    if _do_ensure; then
      ok 'API server ready (after retry)'
    else
      warn "API server not ready. Fix cluster (colima start --with-kubernetes, no --network-address) and re-run."
      exit 1
    fi
  fi
else
  say "3. Skipping ensure-api-server-ready (script not found)"
fi

# Phase 0 (freeze) — optional one-time check. See docs/PREFLIGHT_PHASED_PLAN_20260207.md
if [[ "$PREFLIGHT_PHASE0" == "1" ]] && [[ -f "$SCRIPT_DIR/preflight-phase0-freeze-check.sh" ]]; then
  say "Phase 0 — Freeze check (Colima only, single cluster, reads stable)..."
  chmod +x "$SCRIPT_DIR/preflight-phase0-freeze-check.sh" 2>/dev/null || true
  "$SCRIPT_DIR/preflight-phase0-freeze-check.sh" || exit 1
  ok "Phase 0 freeze OK; exiting (no reissue, no MetalLB, no pgbench/k6)."
  exit 0
fi

# Phase 1A — Read-only checks. Abort on first failure. See docs/PREFLIGHT_PHASED_PLAN_20260207.md
say "Phase 1A — Read-only checks..."
_phase1a_ok=0
if kubectl get nodes --request-timeout=15s >/dev/null 2>&1 && kubectl get ns --request-timeout=10s >/dev/null 2>&1; then
  _phase1a_ok=1
fi
if [[ $_phase1a_ok -eq 0 ]]; then
  echo "[PHASE 1A] FAIL: get nodes or get ns failed (abort)." >&2
  exit 1
fi
echo "[PHASE 1A] READ OK"
ok "Phase 1A read-only OK"

# 3a0. TLS + Kafka secrets expected by manifests (service-tls → och-service-tls, kafka-ssl → och-kafka-ssl-secret).
# Runs before reissue so fresh clusters get a bundle from repo/mkcert + aliases without manual kubectl.
PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS="${PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS:-1}"
if [[ "${PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS}" == "1" ]] && [[ "${SKIP_AUTO_CLUSTER_SECRETS:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh" ]]; then
  _phase_start "3a0_ensure_cluster_secrets"
  say "3a0. Ensuring housing TLS + Kafka client secrets (if missing)…"
  chmod +x "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh" 2>/dev/null || true
  if HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" FORCE_TLS_RESTART=0 "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"; then
    ok "3a0 cluster secrets pass"
  else
    warn "3a0 had issues — continue (reissue / 3b Kafka may still fix)"
  fi
fi

# 3b0. k3d only: wait for all expected nodes to be Ready (2-node cluster). Ensures cluster is fully ready before reissue/MetalLB/applies.
# PREFLIGHT_K3D_EXPECTED_NODES=2 (default), PREFLIGHT_K3D_NODES_READY_WAIT=120 (max seconds). Set NODES_READY_WAIT=0 to skip.
_wait_k3d_nodes_ready() {
  local expected="${PREFLIGHT_K3D_EXPECTED_NODES:-2}"
  local max_wait="${PREFLIGHT_K3D_NODES_READY_WAIT:-120}"
  [[ "$max_wait" -le 0 ]] && return 0
  local interval=5
  local elapsed=0
  local ready=0
  local total=0
  _phase_start "3b0_k3d_nodes_ready"
  say "3b0. k3d: waiting for all $expected node(s) to be Ready (max ${max_wait}s)..."
  while [[ $elapsed -lt $max_wait ]]; do
    _out=$(kubectl get nodes --no-headers --request-timeout=10s 2>/dev/null || true)
    total=$(echo "$_out" | wc -l | tr -d ' \n\r')
    ready=$(echo "$_out" | awk '$2=="Ready" {c++} END {print c+0}' || echo "0")
    total=${total//[!0-9]/}; total=${total:-0}
    ready=${ready//[!0-9]/}; ready=${ready:-0}
    if [[ -n "$_out" ]] && [[ "$total" -ge "$expected" ]] && [[ "$ready" -eq "$total" ]] && [[ "$ready" -ge "$expected" ]]; then
      ok "All $ready node(s) Ready (${elapsed}s)"
      mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
      echo "k3d_nodes_ready: ready=$ready total=$total elapsed_s=$elapsed" >> "$REPO_ROOT/bench_logs/k3d-stabilization-last.txt" 2>/dev/null || true
      return 0
    fi
    [[ $((elapsed % 30)) -eq 0 ]] && [[ $elapsed -gt 0 ]] && info "  ${elapsed}s: nodes Ready $ready/$total (need all $expected nodes Ready)"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  warn "Not all nodes Ready after ${max_wait}s (Ready $ready/$total, expected $expected). Proceeding anyway; later steps may fail."
  mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
  echo "k3d_nodes_ready: timeout ready=$ready total=$total max_wait=$max_wait" >> "$REPO_ROOT/bench_logs/k3d-stabilization-last.txt" 2>/dev/null || true
  return 1
}
if [[ "$ctx" == *"k3d"* ]] && [[ "${PREFLIGHT_K3D_NODES_READY_WAIT:-120}" -gt 0 ]]; then
  _wait_k3d_nodes_ready || true
fi

# Phase D only: MetalLB (no load, no cert work). Run 3c1, 3c2 LoadBalancer, verify allocations.
if _phase_d_only; then
  say "Phase D: MetalLB only (no load, no cert work)..."
  METALLB_ENABLED=1
  if [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/install-metallb-colima.sh" ]]; then
    chmod +x "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null || true
    _pool="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
    METALLB_POOL="$_pool" "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null && ok "MetalLB installed (Colima)" || warn "MetalLB install had issues"
  elif [[ -f "$SCRIPT_DIR/install-metallb.sh" ]]; then
    chmod +x "$SCRIPT_DIR/install-metallb.sh" 2>/dev/null || true
    "$SCRIPT_DIR/install-metallb.sh" 2>/dev/null && ok "MetalLB installed" || warn "MetalLB install had issues"
  fi
  kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null || true
  sleep 2
  if [[ "$ctx" == *"colima"* ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" ]]; then
    kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" --request-timeout=20s 2>/dev/null || true
  else
    [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" ]] && kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" --request-timeout=20s 2>/dev/null || true
  fi
  sleep 2
  if [[ "$ctx" == *"colima"* ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" ]]; then
    kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" --request-timeout=20s 2>/dev/null || true
  else
    [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" ]] && kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" --request-timeout=20s 2>/dev/null || true
  fi
  say "Verify LoadBalancer allocation (thorough MetalLB suite):"
  [[ -f "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" ]] && VERIFY_MODE=stable bash "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" 2>&1 || true
  kubectl get svc -n ingress-nginx caddy-h3 2>/dev/null || true
  ok "Phase D complete. Check caddy-h3 EXTERNAL-IP above."
  exit 0
fi

# Phase B only: cert issuance & rotation (single-threaded, no Service churn). Assume cluster up from Phase A.
if _phase_b_only; then
  say "Phase B: Cert issuance & rotation only (no load, no MetalLB)..."
  # 3a reissue, 3b Kafka SSL, 3b2–3b3, 4c, 4d, 5
  if [[ "$ctx" == *"colima"* ]] && nc -z 127.0.0.1 6443 2>/dev/null; then
    _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
    [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]] && { "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true; sleep 5; }
  fi
  REISSUE_USE_6443=0
  [[ "$ctx" == *"colima"* ]] && nc -z 127.0.0.1 6443 2>/dev/null && REISSUE_USE_6443=1
  say "3a. Reissue CA + leaf..."
  export REISSUE_STEP2_VIA_SSH="${REISSUE_STEP2_VIA_SSH:-1}"
  REISSUE_SKIP_PREFLIGHT="$REISSUE_USE_6443" REISSUE_CAP="${REISSUE_CAP:-0}" KAFKA_SSL=1 "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" || exit 1
  say "3b. Kafka SSL from dev-root-ca..."
  [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]] && { "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true; sleep 5; }
  "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" || exit 1
  command -v docker >/dev/null 2>&1 && [[ -d "$REPO_ROOT/certs/kafka-ssl" ]] && [[ -f "$REPO_ROOT/docker-compose.yml" ]] && ( cd "$REPO_ROOT" && docker compose up -d zookeeper kafka 2>/dev/null ) || true
  say "4c. Re-ensure API server ready..."
  _do_ensure || exit 1
  say "4d. Verify Caddy strict TLS..."
  if [[ "$ctx" == *"k3d"* ]] && [[ -f "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" ]]; then
    "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" || exit 1
  else
    _pf_pid_b=""
    if [[ "$ctx" == *"k3d"* ]]; then
      kubectl port-forward -n ingress-nginx svc/caddy-h3 8443:443 --request-timeout=5s 2>/dev/null & _pf_pid_b=$!
      sleep 4
    fi
    if [[ -n "$_pf_pid_b" ]]; then
      PORT=8443 CADDY_TARGET=127.0.0.1 "$SCRIPT_DIR/verify-caddy-strict-tls.sh" || { kill $_pf_pid_b 2>/dev/null; exit 1; }
      kill $_pf_pid_b 2>/dev/null || true
    else
      "$SCRIPT_DIR/verify-caddy-strict-tls.sh" || exit 1
    fi
  fi
  say "5. Strict TLS/mTLS preflight..."
  "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" || exit 1
  ok "Phase B complete (cert path verified). Run Phase C for load or full for full pipeline."
  exit 0
fi

# Phase C runs only steps 7 and 8 (data-plane load). Skip 3a–6b when Phase C.
# Phase 1B — Serialized writes (mutexed). One writer at a time; lock released after 4a. See docs/PREFLIGHT_PHASED_PLAN_20260207.md
# Visibility: print before acquiring lock so we never appear "stuck" after Phase 1A (k3d 2-node / Colima).
if ! _phase_c_only; then
  if [[ -n "${PREFLIGHT_WRITE_LOCK_FILE:-}" ]]; then
    say "Phase 1B — acquiring write lock (timeout ${PREFLIGHT_LOCK_TIMEOUT:-60}s)..."
    _lock_acquired=0
    if [[ "${PREFLIGHT_USE_MKDIR_LOCK:-0}" == "1" ]]; then
      PREFLIGHT_LOCK_DIR="${PREFLIGHT_WRITE_LOCK_FILE}.d"
      for _lock_attempt in 1 2; do
        _lock_wait=0
        while true; do
          if mkdir "$PREFLIGHT_LOCK_DIR" 2>/dev/null; then
            _lock_acquired=1
            break
          fi
          sleep 1
          _lock_wait=$((_lock_wait + 1))
          [[ $((_lock_wait % 10)) -eq 0 ]] && [[ $_lock_wait -gt 0 ]] && info "  Waiting for write lock... ${_lock_wait}s"
          if [[ $_lock_wait -ge "${PREFLIGHT_LOCK_TIMEOUT:-60}" ]]; then
            if [[ $_lock_attempt -eq 1 ]]; then
              rmdir "$PREFLIGHT_LOCK_DIR" 2>/dev/null && { info "  Removed stale lock dir; retrying..."; break; }
            fi
            echo "[PHASE 1B] FAIL: could not acquire write lock (mkdir $PREFLIGHT_LOCK_DIR, ${PREFLIGHT_LOCK_TIMEOUT}s). Another preflight may be running; remove stale lock: rmdir $PREFLIGHT_LOCK_DIR 2>/dev/null; or set PREFLIGHT_SKIP_WRITE_LOCK=1" >&2
            exit 1
          fi
        done
        [[ $_lock_acquired -eq 1 ]] && break
      done
      if [[ $_lock_acquired -eq 1 ]]; then
        trap 'rmdir "$PREFLIGHT_LOCK_DIR" 2>/dev/null' EXIT
        echo "[PHASE 1B] WRITES (lock acquired, mkdir fallback)"
      else
        echo "[PHASE 1B] FAIL: could not acquire write lock (mkdir). Set PREFLIGHT_SKIP_WRITE_LOCK=1 to disable." >&2
        exit 1
      fi
    else
      for _lock_attempt in 1 2; do
        exec 200>"$PREFLIGHT_WRITE_LOCK_FILE"
        if flock -w "${PREFLIGHT_LOCK_TIMEOUT:-60}" 200 2>/dev/null; then
          _lock_acquired=1
          trap 'exec 200>&- 2>/dev/null' EXIT
          echo "[PHASE 1B] WRITES (lock acquired, flock)"
          break
        fi
        exec 200>&- 2>/dev/null || true
        if [[ $_lock_attempt -eq 1 ]]; then
          # Stale lock: no process may hold it (crashed holder released it; file left behind). Remove and retry once.
          _holders=0
          if command -v lsof >/dev/null 2>&1; then
            _holders=$(lsof "$PREFLIGHT_WRITE_LOCK_FILE" 2>/dev/null | wc -l | tr -d ' ')
          elif command -v fuser >/dev/null 2>&1; then
            _holders=$(( $(fuser "$PREFLIGHT_WRITE_LOCK_FILE" 2>/dev/null | wc -w) ))
          fi
          if [[ "${_holders:-0}" -eq 0 ]]; then
            rm -f "$PREFLIGHT_WRITE_LOCK_FILE" 2>/dev/null && info "  Removed stale lock file; retrying..."
          fi
        else
          echo "[PHASE 1B] FAIL: could not acquire write lock within ${PREFLIGHT_LOCK_TIMEOUT}s (tried twice). Another preflight may be running; or remove stale lock: rm -f $PREFLIGHT_WRITE_LOCK_FILE; or set PREFLIGHT_SKIP_WRITE_LOCK=1" >&2
          exit 1
        fi
      done
    fi
  else
    say "Phase 1B — writes (no lock)"
    echo "[PHASE 1B] WRITES (no lock — PREFLIGHT_WRITE_LOCK_FILE= or PREFLIGHT_SKIP_WRITE_LOCK=1)"
  fi

# 2e. Ensure Caddy configmap + (optionally) deploy exist before reissue — pods mount configmap "caddy-h3"; if deploy exists but configmap was missing, pods stay ContainerCreating (FailedMount). Always ensure namespace + configmap; create deploy only when missing.
if ! _phase_a_only; then
  _phase_start "2e_caddy"
  say "2e. Ensuring ingress-nginx + Caddy configmap (and deploy if missing)..."
  kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null || true
  sleep "${APPLY_RATE_LIMIT_SLEEP:-2}"
  _caddyfile="${REPO_ROOT}/Caddyfile"
  [[ -f "$_caddyfile" ]] || _caddyfile="${REPO_ROOT}/docs/Caddyfile"
  if [[ -f "$_caddyfile" ]]; then
    kubectl create configmap caddy-h3 -n ingress-nginx --from-file=Caddyfile="$_caddyfile" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null && ok "Caddy configmap caddy-h3 ensured" || warn "Caddy configmap create/apply failed (Caddy pods will fail mount until 3c2)"
  else
    warn "Caddyfile not found at $REPO_ROOT/Caddyfile or $REPO_ROOT/docs/Caddyfile; Caddy configmap not created"
  fi
  if ! kubectl get deploy caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
    _lb_ns=0
    kubectl get ns metallb-system --request-timeout=5s >/dev/null 2>&1 && _lb_ns=1
    _use_lb=0
    [[ "${METALLB_ENABLED:-0}" == "1" ]] && _use_lb=1
    [[ "$ctx" == *"colima"* ]] && [[ "$_lb_ns" == "1" ]] && _use_lb=1
    # Colima + LB: use deploy without hostPort (soft anti-affinity) so 2 pods schedule on 1 node
    if [[ "$_use_lb" == "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" ]]; then
      kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" --request-timeout=20s 2>/dev/null || true
    elif [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" ]]; then
      kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml" --request-timeout=20s 2>/dev/null || true
    fi
    if [[ "$_use_lb" == "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" ]]; then
      kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" --request-timeout=20s 2>/dev/null && true
    elif [[ "$_use_lb" == "1" ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" ]]; then
      kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" --request-timeout=20s 2>/dev/null && true
    else
      [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" ]] && kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" --request-timeout=20s 2>/dev/null && true
    fi
    ok "Caddy deploy + service applied (reissue can restart Caddy)"
  fi
fi

# 3c1-early. On Colima with MetalLB: install MetalLB *before* reissue so the webhook is ready while API is calm.
# Standalone verify works because MetalLB is already up; during preflight reissue hammers the API, so installing
# MetalLB after reissue often hits "webhook endpoint not ready". Pre-wire: install here, then 3c1 skips install.
_preflight_metallb_installed_early=0
if ! _phase_a_only; then
  if [[ "${METALLB_ENABLED:-0}" == "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/install-metallb-colima.sh" ]]; then
    _phase_start "3c1_early_metallb"
    say "3c1-early. MetalLB install (before reissue so webhook is ready while API is calm)..."
    chmod +x "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null || true
    # Pass pool and webhook wait so child script sees them (shell vars are not exported to children).
    _pool="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
    _webhook_wait="${PREFLIGHT_METALLB_WEBHOOK_WAIT:-12}"
    if METALLB_POOL="$_pool" PREFLIGHT_METALLB_WEBHOOK_WAIT="$_webhook_wait" "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null; then
      ok "MetalLB installed / pool applied (Colima, pre-wired before reissue)"
      _preflight_metallb_installed_early=1
      # Apply Caddy LoadBalancer deploy (soft anti-affinity so 2 pods on 1 node) and service before reissue, so reissue step 5 can reach 2/2.
      if [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" ]]; then
        kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" --request-timeout=25s 2>/dev/null && \
        kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" --request-timeout=25s 2>/dev/null && \
        ok "Caddy LoadBalancer deploy + service applied (before reissue so 2/2 can schedule on single node)" || true
      fi
    else
      warn "MetalLB early install had issues; 3c1 will retry install after reissue"
    fi
  fi
fi

# 3a. Reissue CA + leaf first (dev-root-ca / off-campus-housing-local-tls, CA/Caddy match). KAFKA_SSL=1 persists CA key for Kafka.
# Phase A skips cert work (control-plane sanity only).
if ! _phase_a_only; then
  REISSUE_USE_6443=0
  if [[ "$ctx" == *"colima"* ]] && nc -z 127.0.0.1 6443 2>/dev/null; then
    _cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || echo "colima")
    kubectl config set-cluster "$_cluster" --server="https://127.0.0.1:6443" >/dev/null 2>&1 || true
    REISSUE_USE_6443=1
    if [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
      "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
      sleep 5
    fi
  fi
  _phase_start "3a_reissue"
  _housing_ns="${HOUSING_NS:-off-campus-housing-tracker}"
  _preflight_3a_bootstrap=0
  if [[ "${PREFLIGHT_REISSUE_CA:-0}" != "1" ]]; then
    kubectl get secret service-tls -n "$_housing_ns" -o name --request-timeout=15s &>/dev/null || _preflight_3a_bootstrap=1
    kubectl get secret dev-root-ca -n "$_housing_ns" -o name --request-timeout=15s &>/dev/null || _preflight_3a_bootstrap=1
  fi
  PREFLIGHT_3A_DID_REISSUE=0
  export PREFLIGHT_3A_DID_REISSUE
  if [[ "${PREFLIGHT_REISSUE_CA:-0}" == "1" ]] || [[ "$_preflight_3a_bootstrap" -eq 1 ]]; then
    if [[ "${PREFLIGHT_REISSUE_CA:-0}" == "1" ]]; then
      say "3a. Reissue CA + leaf (PREFLIGHT_REISSUE_CA=1 — full rotation; KAFKA_SSL=1 for Kafka strict TLS)..."
    else
      say "3a. Reissue CA + leaf (bootstrap: service-tls or dev-root-ca missing in $_housing_ns)..."
    fi
    if [[ -f "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh" ]]; then
      export REISSUE_STEP2_VIA_SSH="${REISSUE_STEP2_VIA_SSH:-1}"
      if REISSUE_SKIP_PREFLIGHT="$REISSUE_USE_6443" REISSUE_CAP="${REISSUE_CAP:-0}" KAFKA_SSL=1 "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh"; then
        ok "Reissue done; CA and Caddy certs aligned"
        ok "CA and leaf both rotated (dev-root-ca, off-campus-housing-local-tls, service-tls); certs/dev-root.pem is single source of truth"
        PREFLIGHT_3A_DID_REISSUE=1
        export PREFLIGHT_3A_DID_REISSUE
      else
        warn "Reissue failed — suites may hit curl 60. Fix cluster/certs and re-run."
        if [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/diagnose-reset-by-peer.sh" ]]; then
          say "Running connection-reset diagnostic (15s timeout)..."
          ( DEEP=1 DIAG_GATHER=1 timeout 15 "$SCRIPT_DIR/diagnose-reset-by-peer.sh" 6443 2>/dev/null || true )
          info "Diagnostic log: scripts/diag-reset-*.log"
        fi
        exit 1
      fi
    else
      echo "❌ reissue script not found"
      exit 1
    fi
  else
    say "3a. Skipping CA reissue (PREFLIGHT_REISSUE_CA=0; service-tls + dev-root-ca already in $_housing_ns)."
    info "  Force rotation: PREFLIGHT_REISSUE_CA=1 $0  (or run Phase B only for cert work)."
    ok "3a skipped — steady-state preflight"
  fi
fi
# Brief settle after reissue so API is stable before Kafka SSL (reduces 503 / reset on 3b).
if ! _phase_a_only; then
  if [[ "${PREFLIGHT_3A_DID_REISSUE:-0}" == "1" ]]; then
    sleep 30
  else
    sleep 10
  fi
fi
# 3b. Kafka SSL from dev-root-ca (kafka-ssl-secret for strict TLS). Phase A skips (no cert work).
if ! _phase_a_only; then
  if [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
    "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
    sleep 5
  fi
  _phase_start "3b_kafka_ssl"
  say "3b. Kafka SSL from dev-root-ca (kafka-ssl-secret)..."
  if [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
    chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null || true
    if "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"; then
      ok "kafka-ssl-secret created"
      ok "Kafka mTLS: ssl.client.auth=required (k8s base + docker-compose); clients must present client cert signed by same CA as broker"
    else
      warn "Kafka SSL failed (tunnel may have dropped after reissue). Re-establishing and retrying once..."
      [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]] && { "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true; sleep 5; }
      if "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"; then
        ok "kafka-ssl-secret created (on retry)"
        ok "Kafka mTLS: ssl.client.auth=required (clients must present client cert)"
      else
        warn "Kafka SSL failed — ensure certs/dev-root.pem and certs/dev-root.key exist (reissue with KAFKA_SSL=1). Continuing so strict TLS/mTLS and suites can run; Kafka-consuming services may need kafka-ssl-secret later."
        # Don't exit: allow pipeline to continue to Caddy verify, TLS preflight, and suites
      fi
    fi
  else
    warn "kafka-ssl-from-dev-root.sh not found"
    exit 1
  fi

  # 3b1. Ensure Redis (6380 for housing) is up — externalized; pods connect via host
  REDIS_PORT="${REDIS_PORT:-6380}"
  if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
    say "3b1. Ensuring Docker Redis ($REDIS_PORT) is up..."
    ( cd "$REPO_ROOT" && docker compose up -d redis 2>/dev/null ) && ok "Docker Redis up" || warn "Docker Redis start skipped or failed (run manually: docker compose up -d redis)"
  else
    warn "Docker or docker-compose missing; skip starting Redis"
  fi

  # 3b2. Ensure Docker Kafka (strict TLS :29094 for housing) is up — certs/kafka-ssl now exist
  if command -v docker >/dev/null 2>&1 && [[ -d "$REPO_ROOT/certs/kafka-ssl" ]] && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
    say "3b2. Ensuring Docker Kafka (strict TLS) is up..."
    ( cd "$REPO_ROOT" && docker compose up -d zookeeper kafka 2>/dev/null ) && ok "Docker Kafka up" || warn "Docker Kafka start skipped or failed (run manually: docker compose up -d zookeeper kafka)"
  else
    warn "Docker or certs/kafka-ssl or docker-compose missing; skip starting Kafka"
  fi

  # 3b3. Ensure all 8 Postgres DBs are up (ports 5441–5448; media on 5448)
  if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
    say "3b3. Ensuring Docker Postgres (all 8 DBs: 5441–5448) are up..."
    ( cd "$REPO_ROOT" && docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media 2>/dev/null ) && ok "Docker Postgres (all 8) up" || warn "Docker Postgres start skipped or partial (run manually: docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media)"
    for port in 5441 5442 5443 5444 5445 5446 5447 5448; do
      for _ in 1 2 3 4 5; do
        nc -z 127.0.0.1 "$port" 2>/dev/null && break
        sleep 2
      done
    done
  else
    warn "Docker or docker-compose missing; skip starting Postgres"
  fi

  # 3b4. Preflight does not run Prisma/SQL migrations by default. After reissue/rotation, if auth register/login 503 with INTERNAL, run auth migrations:
  #   POSTGRES_URL_AUTH=postgresql://postgres:postgres@host.docker.internal:5441/auth pnpm -C services/auth-service exec prisma migrate deploy
  # Opt-in: PREFLIGHT_AUTH_PRISMA_MIGRATE=1 runs that migrate deploy (requires pnpm + DB reachable from host).
  if [[ "${PREFLIGHT_AUTH_PRISMA_MIGRATE:-0}" == "1" ]] && command -v pnpm >/dev/null 2>&1; then
    say "3b4a. PREFLIGHT_AUTH_PRISMA_MIGRATE=1 — prisma migrate deploy (auth-service)..."
    _url="${POSTGRES_URL_AUTH:-postgresql://postgres:postgres@127.0.0.1:5441/auth}"
    if ( cd "$REPO_ROOT" && POSTGRES_URL_AUTH="$_url" pnpm -C services/auth-service exec prisma migrate deploy --skip-generate ); then
      ok "Auth prisma migrate deploy completed"
    else
      warn "Auth prisma migrate deploy failed (check POSTGRES_URL_AUTH and Postgres on 5441)"
    fi
  else
    : # Migrations opt-in only (PREFLIGHT_AUTH_PRISMA_MIGRATE=1); no per-run message — see script header 3b4.
  fi
  if [[ -x "$SCRIPT_DIR/inspect-external-db-schemas.sh" ]]; then
    say "3b5. Inspecting external DB schemas (ports 5441-5448) and writing markdown report..."
    if "$SCRIPT_DIR/inspect-external-db-schemas.sh" "$REPO_ROOT/bench_logs" 2>/dev/null; then
      ok "External DB schema inspection passed (markdown report written to bench_logs/)"
    else
      warn "External DB schema inspection reported mismatches. Check latest bench_logs/schema-report-*.md"
    fi
  fi
fi

# 3c. Apply app-config, kafka-external, nginx/haproxy (configmaps + pods for exporters), Kafka-consuming deploys (KAFKA 9093 strict TLS).
_phase_start "3c_apply_app_config"
say "3c. Applying app-config, kafka-external, nginx, haproxy (Kafka strict TLS)..."
for k in "$REPO_ROOT/infra/k8s/base/config" "$REPO_ROOT/infra/k8s/base/kafka-external" "$REPO_ROOT/infra/k8s/base/nginx" "$REPO_ROOT/infra/k8s/base/haproxy"; do
  if [[ -d "$k" ]]; then
    if [[ -n "${APPLY_RATE_LIMIT_SLEEP:-}" ]] && [[ "${APPLY_RATE_LIMIT_SLEEP:-0}" -gt 0 ]]; then
      _apply_with_rate_limit "$k" "$(basename "$k")" && ok "Applied $(basename "$k")" || warn "Apply $k skipped or failed"
    else
      kubectl apply -k "$k" --request-timeout=20s 2>/dev/null && ok "Applied $(basename "$k")" || warn "Apply $k skipped or failed"
    fi
  fi
done
say "3c0-housing. Applying housing app Deployments/Services from infra/k8s/base/<service> (notification-service, etc.)..."
_apply_housing_app_bases
ok "Housing app manifests applied (scale targets exist)"
# On k3d re-apply hostAliases so pods can reach host Postgres/Redis (5441–5448).
if [[ "$ctx" == *"k3d"* ]]; then
  _apply_k3d_host_aliases
  ok "host.docker.internal re-applied after 3c (listings/analytics/media reach 5441–5448)"
fi

# Helper: re-apply registry image on all app deployments (k3d only). Call after 4a recovery, which does apply -k base and can overwrite image to e.g. analytics-service:dev (no registry).
_reapply_k3d_registry_images() {
  local _reg_name="k3d-off-campus-housing-tracker-registry"
  local _deploys="$PREFLIGHT_APP_DEPLOYS"
  for _d in $_deploys; do
    if kubectl get deployment "$_d" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
      kubectl set image "deployment/$_d" -n off-campus-housing-tracker "app=${_reg_name}:5000/${_d}:dev" --request-timeout=10s 2>/dev/null && true
    fi
  done
  info "Deployment images re-set to ${_reg_name}:5000/<service>:dev (recovery pass had overwritten some)"
}

# Helper: apply host.docker.internal hostAlias to all app deployments (k3d only). Call after any step that does kubectl apply -k base (which overwrites hostAliases).
_apply_k3d_host_aliases() {
  local _host_ip="${HOST_GATEWAY_IP:-}"
  if [[ -z "$_host_ip" ]]; then
    # macOS + k3d: use k3d network gateway so pods can reach host (172.20.0.1). 192.168.65.254 is Docker Desktop host but often not routable from k3d pods.
    if [[ "$(uname -s)" == "Darwin" ]]; then
      _host_ip=$(docker network inspect k3d-off-campus-housing-tracker --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)
      [[ -z "$_host_ip" ]] && _host_ip="172.20.0.1"
      [[ "$_host_ip" == "<no value>" ]] && _host_ip="172.20.0.1"
      # Prefer IP resolved from inside cluster when a pod is already up (most reliable for 502/logged:false).
      local _pod
      _pod=$(kubectl get pods -n off-campus-housing-tracker -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
      if [[ -n "$_pod" ]]; then
        local _resolved
        _resolved=$(kubectl exec -n off-campus-housing-tracker "$_pod" -- getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
        if [[ -n "$_resolved" ]] && [[ "$_resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          _host_ip="$_resolved"
        fi
      fi
    else
      _host_ip=$(docker run --rm --network k3d-off-campus-housing-tracker 2>/dev/null alpine getent hosts host.k3d.internal 2>/dev/null | awk '{print $1}' || true)
      [[ -z "$_host_ip" ]] && _host_ip=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || true)
      _host_ip="${_host_ip:-172.20.0.1}"
    fi
  fi
  for _d in $PREFLIGHT_APP_DEPLOYS; do
    if kubectl get deployment "$_d" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
      kubectl patch deployment "$_d" -n off-campus-housing-tracker --type=merge -p "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\",\"host.lima.internal\"]}]}}}}" 2>/dev/null && true
    fi
  done
  info "host.docker.internal -> $_host_ip (k3d network gateway on macOS)"
}

# 3c0. On k3d: ensure host.docker.internal resolves in pods (Redis/Postgres on host; fixes DB/Redis connection timeouts).
if [[ "$ctx" == *"k3d"* ]]; then
  _apply_k3d_host_aliases
  ok "host.docker.internal set for app pods (Redis/DB reachable from cluster)"
fi

# 3c0-colima. On Colima: ensure host.docker.internal resolves to the Mac host so pods can reach Postgres/Redis/Kafka on the host (fixes 0/1 Ready).
_apply_colima_host_aliases() {
  local _host_ip="${HOST_GATEWAY_IP:-}"
  if [[ -z "$_host_ip" ]]; then
    _host_ip=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | tr -d '[:space:]' || true)
    if [[ -z "$_host_ip" ]] && command -v colima >/dev/null 2>&1; then
      _host_ip=$(colima ssh -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' || true)
    fi
    if [[ -z "$_host_ip" ]] && command -v colima >/dev/null 2>&1; then
      _host_ip=$(colima ssh -- ip route show default 2>/dev/null | awk '{print $3}' || true)
    fi
    _host_ip="${_host_ip:-192.168.5.2}"
  fi
  for _d in $PREFLIGHT_APP_DEPLOYS; do
    if kubectl get deployment "$_d" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
      kubectl patch deployment "$_d" -n off-campus-housing-tracker --type=merge -p "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\",\"host.lima.internal\"]}]}}}}" 2>/dev/null && true
    fi
  done
  info "host.docker.internal -> $_host_ip (Colima: Mac host reachable from pods; ensure Postgres/Redis on host: docker compose up -d)"
}
if [[ "$ctx" == *"colima"* ]]; then
  _apply_colima_host_aliases
  ok "host.docker.internal set for Colima app pods (Mac Postgres/Redis reachable)"
fi

# 3c0a0-pre. Ensure all 8 Postgres (5441–5448) are up for suites; ensure kafka-ssl-secret for Kafka TLS (no SQL applied).
if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
  ( cd "$REPO_ROOT" && docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media 2>/dev/null ) && ok "Docker Postgres (5441–5448) ensured up" || true
  if [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && [[ -f "$REPO_ROOT/certs/dev-root.key" ]] && [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
    if ! kubectl get secret kafka-ssl-secret -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
      chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null || true
      "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null && ok "kafka-ssl-secret created (Kafka TLS for analytics)" || warn "kafka-ssl-secret create failed (analytics-service needs it)"
    fi
  fi
fi

# 3c0a. On k3d: ensure app images come from registry (fixes ErrImageNeverPull for social-service and others after apply -k base).
# Caddy/Envoy tcpdump images: only built when BUILD_CADDY_TCPDUMP=1 / BUILD_ENVOY_TCPDUMP=1 (patch applied when image exists).
if [[ "$ctx" == *"k3d"* ]] && [[ -f "$SCRIPT_DIR/k3d-registry-push-and-patch.sh" ]]; then
  _phase_start "3c0a_k3d_registry_push"
  say "3c0a. k3d: pushing :dev images to registry and patching deployments (7/7 ready; Caddy+Envoy tcpdump only if image exists; set BUILD_CADDY_TCPDUMP=1/BUILD_ENVOY_TCPDUMP=1 to build)..."
  chmod +x "$SCRIPT_DIR/k3d-registry-push-and-patch.sh" 2>/dev/null || true
  _reg_ret=0
  BUILD_CADDY_TCPDUMP="${BUILD_CADDY_TCPDUMP:-0}" BUILD_ENVOY_TCPDUMP="${BUILD_ENVOY_TCPDUMP:-0}" TELEMETRY_DURING="${TELEMETRY_DURING:-}" "$SCRIPT_DIR/k3d-registry-push-and-patch.sh" 2>&1 || _reg_ret=$?
  if [[ $_reg_ret -eq 0 ]]; then
    ok "Registry push and patch done (deployments use registry:5000/<service>:dev, IfNotPresent)"
    if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
      if kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=120s 2>/dev/null; then
        ok "caddy-h3 rollout complete (2/2 pods on caddy-with-tcpdump)"
      else
        _avail=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo "0")
        _total=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
        _desired=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "2")
        if [[ "${_avail:-0}" -ge 2 ]] && [[ "${_total:-0}" -gt 2 ]]; then
          info "caddy-h3 has 2 available but extra pod (${_total} total, likely ErrImagePull); resetting to default image for 2/2..."
          if [[ -f "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" ]]; then
            chmod +x "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" 2>/dev/null || true
            if "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" 2>/dev/null; then
              ok "caddy-h3 reset to default image (2/2 pods)"
            else
              warn "caddy-h3 reset had issues; run: $SCRIPT_DIR/reset-caddy-h3-to-default-image.sh"
            fi
          else
            if kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=caddy:2.8 --request-timeout=10s 2>/dev/null; then
              kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=90s 2>/dev/null && ok "caddy-h3 set to caddy:2.8 (2/2)" || ok "caddy-h3 image updated (wait for 2/2)"
            else
              warn "caddy-h3 reset failed; run: kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=caddy:2.8"
            fi
          fi
        elif [[ "${_avail:-0}" -ge 2 ]]; then
          ok "caddy-h3 has 2/2 available (rollout complete)"
        else
          warn "caddy-h3 rollout status timed out or failed (available=${_avail:-0}, desired=${_desired:-2})"
        fi
      fi
    fi
  else
    warn "Registry push/patch had issues (exit $_reg_ret). If 1: cluster missing or :dev images not built — run ./scripts/build-and-load-k3d.sh or run-full-flow-k3d.sh; continuing"
  fi
fi

# 3c0b. On k3d only: wait for API to stabilize after node restart (3c0a). Prevents 3c1/3c2/3f from hitting 503 or timeouts.
# Root cause: after node restart kubeconfig can be stale (new API port). We refresh kubeconfig at start and every 30s; re-apply 127.0.0.1.
# PREFLIGHT_K3D_API_STABILIZE_SLOTS: number of 5s slots (default 90 = 7.5 min). Success = 3 consecutive get nodes OK.
# Telemetry: when PREFLIGHT_TELEMETRY=1 we append API diagnostic to TELEMETRY_DURING on each progress (so you can see why get nodes failed).
if [[ "$ctx" == *"k3d"* ]]; then
  _phase_start "3c0b_k3d_api_stabilize"
  _api_slots="${PREFLIGHT_K3D_API_STABILIZE_SLOTS:-90}"
  _api_ok=0
  _consecutive=0
  _last_slot=0
  _stable_at_s=""
  _max_sec=$((_api_slots * 5))
  _k3d_cluster="${ctx#k3d-}"
  # Refresh kubeconfig so we hit current API port after node restart
  if command -v k3d >/dev/null 2>&1; then
    k3d kubeconfig merge "$_k3d_cluster" --kubeconfig-merge-default 2>/dev/null || true
  fi
  # Apply 127.0.0.1 fix so we don't use 0.0.0.0 or host.docker.internal
  _api_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  _api_cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
  if [[ "$_api_server" != *"127.0.0.1"* ]] && [[ "$_api_server" =~ :([0-9]+) ]]; then
    kubectl config set-cluster "$_api_cluster" --server="https://127.0.0.1:${BASH_REMATCH[1]}" >/dev/null 2>&1 || true
  fi
  [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]] && PREFLIGHT_CAP=20 "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || true
  if [[ "${PREFLIGHT_TELEMETRY:-0}" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]] && [[ -w "${TELEMETRY_DURING:-}" ]]; then
    echo "=== k3d_api_stabilize START (after 3c0a node restart; look for 'k3d_api_stabilize' blocks below for why get nodes failed) ===" >> "$TELEMETRY_DURING"
  fi
  info "k3d: waiting for API to stabilize (3 consecutive 'kubectl get nodes' OK, up to ${_max_sec}s); kubeconfig refreshed every 30s..."
  [[ "${PREFLIGHT_TELEMETRY:-0}" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]] && info "  On FAIL: API diagnostic (api_server_url, nc, stderr) → $TELEMETRY_DURING"
  _last_err=""
  for _s in $(seq 1 "$_api_slots"); do
    if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
      _consecutive=$((_consecutive + 1))
      _last_err=""
      if [[ $_consecutive -ge 3 ]]; then
        _api_ok=1
        _stable_at_s=$((_s * 5))
        _last_slot=$_s
        break
      fi
    else
      _consecutive=0
      _last_err=$(kubectl get nodes --request-timeout=5s 2>&1 | head -3 || true)
    fi
    _last_slot=$_s
    # Re-refresh kubeconfig every 30s (6 slots) and re-apply 127.0.0.1 so we pick up new API port quickly
    if [[ $((_s % 6)) -eq 0 ]] && [[ $_s -ge 6 ]]; then
      if command -v k3d >/dev/null 2>&1; then
        k3d kubeconfig merge "$_k3d_cluster" --kubeconfig-merge-default 2>/dev/null || true
        _api_server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
        _api_cluster=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.cluster}' 2>/dev/null || true)
        if [[ -n "$_api_server" ]] && [[ "$_api_server" != *"127.0.0.1"* ]] && [[ "$_api_server" =~ :([0-9]+) ]]; then
          kubectl config set-cluster "$_api_cluster" --server="https://127.0.0.1:${BASH_REMATCH[1]}" >/dev/null 2>&1 || true
        fi
      fi
    fi
    # Progress every 30s: show elapsed, OK/FAIL, and last error; write API diagnostic to telemetry when FAIL
    if [[ $((_s % 6)) -eq 0 ]] && [[ $_s -ge 6 ]]; then
      _elapsed_s=$((_s * 5))
      if [[ $_consecutive -gt 0 ]]; then
        info "k3d API stabilize: ${_elapsed_s}s elapsed, get nodes: OK ($_consecutive/3) (max ${_max_sec}s)"
      else
        info "k3d API stabilize: ${_elapsed_s}s elapsed, get nodes: FAIL (max ${_max_sec}s)"
        if [[ -n "$_last_err" ]]; then
          echo "$_last_err" | sed 's/^/    /' | head -5
        fi
        info "  → kubeconfig refreshed every 30s; if still failing: kubectl get nodes; or run ensure-api-server-ready.sh"
        # Append API diagnostic to telemetry so we can see why get nodes failed (port, nc, stderr)
        if [[ "${PREFLIGHT_TELEMETRY:-0}" == "1" ]] && [[ -n "${TELEMETRY_DURING:-}" ]] && [[ -w "${TELEMETRY_DURING:-}" ]]; then
          _api_url=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || echo "?")
          _api_port=""
          [[ "$_api_url" =~ :([0-9]+) ]] && _api_port="${BASH_REMATCH[1]}"
          _nc_ok="n"
          [[ -n "$_api_port" ]] && ( nc -z -w 2 127.0.0.1 "$_api_port" 2>/dev/null || nc -z -G 2 127.0.0.1 "$_api_port" 2>/dev/null ) && _nc_ok="y"
          {
            echo "--- k3d_api_stabilize (elapsed=${_elapsed_s}s slot=$_s) ---"
            echo "  api_server_url=$_api_url"
            echo "  nc_127_0_0_1_port=$_nc_ok"
            echo "  get_nodes_stderr: $_last_err"
            echo "---"
          } >> "$TELEMETRY_DURING" 2>/dev/null || true
        fi
      fi
    fi
    sleep 5
  done
  _elapsed=$((_last_slot * 5))
  mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
  if [[ $_api_ok -eq 1 ]]; then
    ok "k3d API stable after ${_stable_at_s}s (3 consecutive get nodes OK); proceeding with MetalLB/Caddy/applies"
    echo "k3d_api_stabilization: stable_after_s=${_stable_at_s} elapsed_s=${_elapsed} slots=${_api_slots}" >> "$REPO_ROOT/bench_logs/k3d-stabilization-last.txt" 2>/dev/null || true
    # Require all nodes Ready before MetalLB/Caddy (after restart nodes may still be NotReady)
    if [[ "${PREFLIGHT_K3D_NODES_READY_WAIT:-120}" -gt 0 ]]; then
      _wait_k3d_nodes_ready || true
    fi
  else
    warn "k3d API did not stabilize after ${_elapsed}s (max ${_max_sec}s). MetalLB/Caddy may fail."
    [[ -n "$_last_err" ]] && echo "$_last_err" | sed 's/^/  /' | head -3
    warn "  → k3d kubeconfig merge $_k3d_cluster; kubectl get nodes; or scripts/ensure-api-server-ready.sh"
    echo "k3d_api_stabilization: did_not_stabilize elapsed_s=${_elapsed} max_s=${_max_sec}" > "$REPO_ROOT/bench_logs/k3d-stabilization-last.txt" 2>/dev/null || true
  fi
fi

# 3c1. MetalLB: opt-in only (METALLB_ENABLED=1). Disabled for core preflight.
# When METALLB_VERIFY_COLIMA_L2=1: enable FRR BGP by default so step 3c1a runs (user gets full BGP + L2). Set METALLB_FRR_BGP=0 to skip.
[[ "${METALLB_VERIFY_COLIMA_L2:-0}" == "1" ]] && [[ "${METALLB_FRR_BGP:-0}" != "0" ]] && METALLB_FRR_BGP=1
# When METALLB_VERIFY_COLIMA_L2=1: real L2 (ARP/asymmetric/BGP) runs in step 3c1c on Colima only; Colima must be running.
if [[ "${METALLB_VERIFY_COLIMA_L2:-0}" == "1" ]] && [[ "${METALLB_ENABLED:-0}" == "1" ]] && [[ "$ctx" == *"k3d"* ]]; then
  _get_colima_context_for_metallb
  if [[ -z "${_colima_ctx_for_metallb:-}" ]]; then
    info "METALLB_VERIFY_COLIMA_L2=1: Colima not available (start with: colima start --with-kubernetes). Step 3c1b runs on k3d; step 3c1c (real L2) will be skipped. See docs/METALLB_INGRESS_EGRESS_AND_REAL_L2.md"
  else
    info "METALLB_VERIFY_COLIMA_L2=1: Colima context found; step 3c1c will run real L2/BGP on Colima after 3c1b on k3d."
  fi
fi
# On Colima use install-metallb-colima.sh (native + pool + L2). On k3d use install-metallb.sh if present.
# Colima: if we already ran 3c1-early (before reissue), skip install and go straight to 3c2/3c1b.
if [[ "${METALLB_ENABLED:-0}" == "1" ]]; then
  say "3c1. MetalLB (LoadBalancer for Caddy)..."
  if [[ "$ctx" == *"colima"* ]] && [[ "${_preflight_metallb_installed_early:-0}" == "1" ]]; then
    ok "MetalLB already installed (pre-wired before reissue); applying Caddy and verifying."
  elif [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/install-metallb-colima.sh" ]]; then
    chmod +x "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null || true
    _pool="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
    if METALLB_POOL="$_pool" "$SCRIPT_DIR/install-metallb-colima.sh" 2>/dev/null; then
      ok "MetalLB installed / pool applied (Colima)"
    else
      warn "MetalLB install had issues (LoadBalancer IPs may be pending); continuing"
    fi
  elif [[ -f "$SCRIPT_DIR/install-metallb.sh" ]]; then
    chmod +x "$SCRIPT_DIR/install-metallb.sh" 2>/dev/null || true
    [[ "$ctx" == *"k3d"* ]] && export MAX_RETRIES="${MAX_RETRIES:-24}"
    if "$SCRIPT_DIR/install-metallb.sh" 2>/dev/null; then
      ok "MetalLB installed / pool applied"
    else
      warn "MetalLB install had issues (LoadBalancer IPs may be pending); continuing"
    fi
  else
    info "MetalLB script not found (Colima: install-metallb-colima.sh; k3d: install-metallb.sh); ensure MetalLB is installed and pool applied"
  fi
  # Optional: FRR BGP for full BGP verification (METALLB_FRR_BGP=1). Fails gracefully to L2.
  if [[ "${METALLB_FRR_BGP:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/install-metallb-frr-bgp.sh" ]]; then
    say "3c1a. MetalLB FRR BGP (optional)..."
    bash "$SCRIPT_DIR/install-metallb-frr-bgp.sh" 2>&1 || warn "FRR BGP had issues; continuing with L2"
  fi
  # 3c2. Apply Caddy deploy + service *before* MetalLB verify (3c1b) so caddy-h3 exists and gets LB IP. Standalone verify works because Caddy is already up; in preflight we must apply Caddy here.
  say "3c2. Applying Caddy (ingress-nginx) before MetalLB verification..."
  kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null || true
  sleep "${APPLY_RATE_LIMIT_SLEEP:-2}"
  _apply_retries_c2=1
  [[ "$ctx" == *"k3d"* ]] && _apply_retries_c2=3
  _metallb_ns_exists=0
  kubectl get ns metallb-system --request-timeout=5s >/dev/null 2>&1 && _metallb_ns_exists=1
  _use_caddy_loadbalancer=0
  [[ "${METALLB_ENABLED:-0}" == "1" ]] && _use_caddy_loadbalancer=1
  [[ "$ctx" == *"colima"* ]] && [[ "$_metallb_ns_exists" == "1" ]] && _use_caddy_loadbalancer=1
  # Colima + LoadBalancer: use deploy without hostPort and with soft anti-affinity so 2 replicas schedule on 1 node.
  _caddy_deploy="$REPO_ROOT/infra/k8s/caddy-h3-deploy.yaml"
  [[ "$ctx" == *"colima"* ]] && [[ "$_use_caddy_loadbalancer" == "1" ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml" ]] && _caddy_deploy="$REPO_ROOT/infra/k8s/caddy-h3-deploy-loadbalancer.yaml"
  if [[ -f "$_caddy_deploy" ]]; then
    _ok=0
    for _r in $(seq 1 $_apply_retries_c2); do
      if [[ -n "${APPLY_RATE_LIMIT_SLEEP:-}" ]] && [[ "${APPLY_RATE_LIMIT_SLEEP:-0}" -gt 0 ]]; then
        _apply_file_with_rate_limit "$_caddy_deploy" "$(basename "$_caddy_deploy")" && _ok=1 && break
      else
        kubectl apply -f "$_caddy_deploy" --request-timeout=25s 2>/dev/null && _ok=1 && break
      fi
      [[ $_r -lt $_apply_retries_c2 ]] && { warn "Apply $(basename "$_caddy_deploy") failed (attempt $_r); retrying in 20s..."; sleep 20; }
    done
    [[ $_ok -eq 0 ]] && warn "Apply $(basename "$_caddy_deploy") failed after $_apply_retries_c2 attempts"
  fi
  # Use LoadBalancer when METALLB_ENABLED=1 or when Colima + MetalLB namespace exists
  if [[ "$_use_caddy_loadbalancer" == "1" ]]; then
    if [[ "$ctx" == *"colima"* ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" ]]; then
      _ok=0
      for _r in $(seq 1 $_apply_retries_c2); do
        if [[ -n "${APPLY_RATE_LIMIT_SLEEP:-}" ]] && [[ "${APPLY_RATE_LIMIT_SLEEP:-0}" -gt 0 ]]; then
          _apply_file_with_rate_limit "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" "caddy-h3-service-loadbalancer.yaml" && _ok=1 && break
        else
          kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml" --request-timeout=25s 2>/dev/null && _ok=1 && break
        fi
        [[ $_r -lt $_apply_retries_c2 ]] && { warn "Apply caddy-h3-service-loadbalancer.yaml failed (attempt $_r); retrying in 20s..."; sleep 20; }
      done
      [[ $_ok -eq 1 ]] && ok "Applied caddy-h3-service-loadbalancer.yaml (LoadBalancer, MetalLB L2)" || warn "Apply caddy-h3-service-loadbalancer.yaml failed"
    elif [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" ]]; then
      _current_np=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      [[ -n "$_current_np" ]] && [[ "$_current_np" != "30443" ]] && { kubectl -n ingress-nginx delete svc caddy-h3 --ignore-not-found --request-timeout=10s 2>/dev/null || true; sleep 2; }
      _ok=0
      for _r in $(seq 1 $_apply_retries_c2); do
        if [[ -n "${APPLY_RATE_LIMIT_SLEEP:-}" ]] && [[ "${APPLY_RATE_LIMIT_SLEEP:-0}" -gt 0 ]]; then
          _apply_file_with_rate_limit "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" "caddy-h3-service.yaml" && _ok=1 && break
        else
          kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service.yaml" --request-timeout=25s 2>/dev/null && _ok=1 && break
        fi
        [[ $_r -lt $_apply_retries_c2 ]] && { warn "Apply caddy-h3-service.yaml failed (attempt $_r); retrying in 20s..."; sleep 20; }
      done
      [[ $_ok -eq 0 ]] && warn "Apply caddy-h3-service.yaml failed"
    fi
  else
    [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" ]] && { kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" --request-timeout=20s 2>/dev/null && ok "Applied caddy-h3-service-nodeport.yaml" || true; }
  fi
  _caddyfile_3c2_early="${REPO_ROOT}/Caddyfile"
  [[ -f "$_caddyfile_3c2_early" ]] || _caddyfile_3c2_early="${REPO_ROOT}/docs/Caddyfile"
  [[ -f "$_caddyfile_3c2_early" ]] && kubectl create configmap caddy-h3 -n ingress-nginx --from-file=Caddyfile="$_caddyfile_3c2_early" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=10s 2>/dev/null && ok "Caddy configmap ensured" || true
  if [[ -f "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" ]]; then
    # Wait for Caddy to be ready so LB IP curl and in-cluster checks succeed (Caddy can be slow after apply/restart).
    if kubectl get deploy caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
      _caddy_wait="${PREFLIGHT_CADDY_ROLLOUT_WAIT:-120}"
      info "Waiting up to ${_caddy_wait}s for caddy-h3 rollout before MetalLB verification..."
      if kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout="${_caddy_wait}s" 2>/dev/null; then
        ok "caddy-h3 rollout ready (2/2 pods)"
      else
        _avail=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo "0")
        _total=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
        if [[ "${_avail:-0}" -ge 2 ]] && [[ "${_total:-0}" -gt 2 ]]; then
          info "caddy-h3 has 2 available but extra pod (${_total} total); cleaning up so 3c1b verify sees exactly 2 pods..."
          if [[ -f "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" ]]; then
            chmod +x "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" 2>/dev/null || true
            "$SCRIPT_DIR/reset-caddy-h3-to-default-image.sh" 2>/dev/null && ok "caddy-h3 reset to 2/2 before MetalLB verification" || true
          else
            kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=caddy:2.8 --request-timeout=10s 2>/dev/null && kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=60s 2>/dev/null || true
          fi
          # If still 3 pods (e.g. Pending from anti-affinity + maxSurge, same image), scale down ReplicaSets with 0 ready
          _total_after=$(kubectl get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
          if [[ "${_total_after:-0}" -gt 2 ]]; then
            for _rs in $(kubectl get rs -n ingress-nginx -l app=caddy-h3 -o jsonpath='{range .items[?(@.status.readyReplicas==0)]}{.metadata.name}{"\n"}{end}' 2>/dev/null); do
              [[ -z "$_rs" ]] && break
              kubectl scale rs "$_rs" -n ingress-nginx --replicas=0 --request-timeout=10s 2>/dev/null && info "Scaled down extra caddy ReplicaSet $_rs" || true
            done
          fi
        elif [[ "${_avail:-0}" -ge 2 ]]; then
          ok "caddy-h3 has 2/2 available"
        else
          warn "caddy-h3 rollout not ready within ${_caddy_wait}s (available=${_avail:-0}); MetalLB verification may see connection refused"
        fi
      fi
    fi
    # Guarantee Caddy (and Envoy) use tcpdump images so 6e ensure-tcpdump never times out on install
    if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
      _img="caddy-with-tcpdump:dev"
      if [[ "$ctx" == *"k3d"* ]] && [[ -n "${K3D_REGISTRY_NAME:-}" ]]; then
        _img="${K3D_REGISTRY_NAME:-k3d-off-campus-housing-tracker-registry}:5000/caddy-with-tcpdump:dev"
      fi
      if kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=$_img" --request-timeout=10s 2>/dev/null; then
        info "caddy-h3 patched to $_img (tcpdump in image); waiting for rollout..."
        if kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=90s 2>/dev/null; then
          ok "caddy-h3 rollout complete (tcpdump in image; 6e will skip install)"
        else
          warn "caddy-h3 rollout after tcpdump patch timed out; 6e may install tcpdump in pods"
        fi
      fi
    fi
    if docker image inspect envoy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment envoy-test -n envoy-test --request-timeout=5s >/dev/null 2>&1; then
      _eimg="envoy-with-tcpdump:dev"
      if [[ "$ctx" == *"k3d"* ]] && [[ -n "${K3D_REGISTRY_NAME:-}" ]]; then
        _eimg="${K3D_REGISTRY_NAME:-k3d-off-campus-housing-tracker-registry}:5000/envoy-with-tcpdump:dev"
      fi
      kubectl set image deployment/envoy-test -n envoy-test "envoy=$_eimg" --request-timeout=10s 2>/dev/null && \
        kubectl rollout status deployment/envoy-test -n envoy-test --timeout=60s 2>/dev/null && \
        ok "envoy-test patched to tcpdump image (6e will skip install)" || true
    fi
    say "3c1b. MetalLB verification (thorough suite)..."
    # Ingress/egress for k3d: verify script runs setup-lb-ip-host-access.sh (host→LB IP) and uses cluster DNS for pods→Caddy.
    # When METALLB_VERIFY_COLIMA_L2=1: skip advanced on k3d (simulated); full L2/BGP verification runs on Colima in step 3c1c.
    if [[ "${METALLB_VERIFY_COLIMA_L2:-0}" == "1" ]]; then
      VERIFY_MODE=stable SKIP_METALLB_ADVANCED=1 bash "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" 2>&1 || warn "MetalLB verification had issues; continuing"
    else
      VERIFY_MODE=stable bash "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" 2>&1 || warn "MetalLB verification had issues; continuing"
    fi
  fi
  # Optional: run real L2/BGP verification on Colima k3s only (isolated). k3d uses loopback+socat so L2/ARP/BGP are simulated; Colima k3s gives real network and meaningful L2/BGP. Switch to Colima for this step only, then restore k3d.
  if [[ "${METALLB_VERIFY_COLIMA_L2:-0}" == "1" ]] && [[ "$ctx" == *"k3d"* ]] && [[ -f "$SCRIPT_DIR/verify-metallb-colima-l2-only.sh" ]]; then
    _saved_ctx="$ctx"
    _saved_kubeconfig="${KUBECONFIG:-$HOME/.kube/config}"
    _get_colima_context_for_metallb
    _colima_ctx="$_colima_ctx_for_metallb"
    if [[ -n "$_colima_ctx" ]]; then
      say "3c1c. MetalLB verification on Colima k3s (real L2/BGP — isolated from k3d)..."
      info "Switching to Colima k3s for real L2/ARP/asymmetric/hairpin/BGP tests only; preflight and suites remain on k3d. After this step, context is restored to k3d."
      kubectl config use-context "$_colima_ctx" 2>/dev/null || true
      # Ensure Colima has MetalLB + pool + L2 + Caddy LoadBalancer so real ARP, asymmetric, hairpin, and BGP tests have ingress/egress configured.
      if [[ -f "$SCRIPT_DIR/ensure-colima-metallb-for-l2.sh" ]]; then
        info "Ensuring Colima has MetalLB and ingress/egress for real L2..."
        COLIMA_FOR_L2=1 bash "$SCRIPT_DIR/ensure-colima-metallb-for-l2.sh" 2>&1 || warn "ensure-colima-metallb-for-l2 had issues; continuing with verification"
      fi
      METALLB_VERIFY_COLIMA_FULL=1 bash "$SCRIPT_DIR/verify-metallb-colima-l2-only.sh" 2>&1 || warn "Colima L2/BGP verification had issues; continuing"
      export KUBECONFIG="$_saved_kubeconfig"
      kubectl config use-context "$_saved_ctx" 2>/dev/null || true
      ok "Restored context to k3d ($_saved_ctx) for rest of preflight and suites."
    else
      warn "METALLB_VERIFY_COLIMA_L2=1 but no Colima context found (Colima may be stopped or kubeconfig path different)."
      if command -v colima &>/dev/null; then
        info "colima status: $(colima status 2>&1 | head -3)"
      else
        info "colima not in PATH; install or add to PATH for L2 verification on Colima."
      fi
      for _ck in "$HOME/.colima/default/kubernetes/kubeconfig" "$HOME/.colima/default/kubeconfig"; do
        if [[ -f "$_ck" ]]; then info "Colima kubeconfig exists: $_ck"; else info "Colima kubeconfig missing: $_ck"; fi
      done
      info "Start Colima: colima start --with-kubernetes"
      info "Preflight merges Colima kubeconfig for step 3c1c only; no need to merge by hand. Re-run with METALLB_VERIFY_COLIMA_L2=1 after Colima is running."
    fi
  fi
fi

# 3c2 already applied above (before 3c1b MetalLB verification) so caddy-h3 exists and has LB IP when verify runs.

# 3d. Remove in-cluster Kafka, Zookeeper, Postgres (all externalized)
say "3d. Removing in-cluster Kafka, Zookeeper, Postgres..."
_rm_deploy() {
  local name=$1
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl delete deploy -n off-campus-housing-tracker "$name" --ignore-not-found --request-timeout=10s 2>/dev/null || true
  else
    _kubectl delete deploy -n off-campus-housing-tracker "$name" --ignore-not-found 2>/dev/null || true
  fi
}
_rm_deploy kafka
_rm_deploy zookeeper
_rm_deploy postgres
# Clean up Postgres PVC/SVC if present
if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
  colima ssh -- kubectl delete svc -n off-campus-housing-tracker postgres --ignore-not-found --request-timeout=10s 2>/dev/null || true
  colima ssh -- kubectl delete pvc -n off-campus-housing-tracker pgdata --ignore-not-found --request-timeout=10s 2>/dev/null || true
else
  _kubectl delete svc -n off-campus-housing-tracker postgres --ignore-not-found 2>/dev/null || true
  _kubectl delete pvc -n off-campus-housing-tracker pgdata --ignore-not-found 2>/dev/null || true
fi
ok "In-cluster Kafka, Zookeeper, Postgres removed"

# 3e. Patch kafka-external Endpoints to host IP (strict TLS :29094 for housing)
KAFKA_SSL_PORT="${KAFKA_SSL_PORT:-29094}"
if [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/patch-kafka-external-host.sh" ]]; then
  say "3e. Patching kafka-external host IP (strict TLS :$KAFKA_SSL_PORT)..."
  chmod +x "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null || true
  "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null && ok "kafka-external patched" || warn "kafka-external patch skipped (run after kubectl apply -k)"
fi

# 3f. Restart Kafka-consuming services (pick up kafka-ssl-secret + kafka-external strict TLS)
say "3f. Restarting analytics-service (pick up Kafka strict TLS)..."
_restart_one() {
  local name=$1
  local max_tries=1
  [[ "$ctx" == *"k3d"* ]] && max_tries=2
  local rc=1
  for _t in $(seq 1 $max_tries); do
    if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      colima ssh -- kubectl rollout restart deploy -n off-campus-housing-tracker "$name" --request-timeout=15s 2>/dev/null && rc=0
    else
      _kubectl rollout restart deploy -n off-campus-housing-tracker "$name" 2>/dev/null && rc=0
    fi
    [[ $rc -eq 0 ]] && { ok "$name restarted"; return 0; }
    [[ $_t -lt $max_tries ]] && { warn "$name restart failed (attempt $_t); retrying in 15s..."; sleep 15; }
  done
  warn "$name restart failed"
}
_restart_one analytics-service

# --- Step 4: Scale to baseline (1 replica per app, exporters 1, Envoy 1, Caddy 2) ---
_phase_start "4_scale_baseline"
say "4. Scaling to baseline (service 1, exporters 1, Envoy 1, Caddy 2)..."
_scale_one() {
  local name=$1 ns=${2:-off-campus-housing-tracker} rep=${3:-1} rc=1
  local _kd="$REPO_ROOT/infra/k8s/base/$name"
  local _exists=0
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl get deploy -n "$ns" "$name" --request-timeout=10s >/dev/null 2>&1 && _exists=1
  else
    _kubectl get deploy -n "$ns" "$name" >/dev/null 2>&1 && _exists=1
  fi
  if [[ "$_exists" -ne 1 ]] && [[ -d "$_kd" ]] && [[ -f "$_kd/kustomization.yaml" ]]; then
    warn "Deployment $name not in $ns; applying infra/k8s/base/$name..."
    _apply_with_rate_limit "$_kd" "housing-$name" || true
  fi
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl scale deploy -n "$ns" "$name" --replicas="$rep" --request-timeout=15s 2>/dev/null && rc=0
  else
    _kubectl scale deploy -n "$ns" "$name" --replicas="$rep" 2>/dev/null && rc=0
  fi
  if [[ "$rc" -eq 0 ]]; then ok "$name=$rep"; else warn "scale $name failed"; fi
  sleep 1
}
set +e
BASELINE_DEPLOYS="$PREFLIGHT_APP_DEPLOYS"
for deploy in $BASELINE_DEPLOYS; do
  _scale_one "$deploy"
done
for ex in nginx-exporter haproxy-exporter; do _scale_one "$ex"; done
_scale_one "envoy-test" "envoy-test"
_scale_one "caddy-h3" "ingress-nginx" 2
set -e

# 4a. Recovery pass: after reissue + applies + scale, API may have been overloaded. One retry of failed applies and scale.
if [[ "${PREFLIGHT_RECOVERY_PASS:-1}" == "1" ]] && [[ "$PREFLIGHT_PHASE" == "full" ]]; then
  say "4a. Recovery pass (wait 30s, retry applies + scale once)..."
  sleep 30
  for k in "$REPO_ROOT/infra/k8s/base/config" "$REPO_ROOT/infra/k8s/base/kafka-external" "$REPO_ROOT/infra/k8s/base/nginx" "$REPO_ROOT/infra/k8s/base/haproxy"; do
    [[ -d "$k" ]] && kubectl apply -k "$k" --request-timeout=25s 2>/dev/null && ok "Recovery: $(basename "$k")" || true
  done
  _apply_housing_app_bases
  # Recovery: use LoadBalancer on Colima when MetalLB exists; otherwise NodePort
  _metallb_ns_recovery=0
  kubectl get ns metallb-system --request-timeout=5s >/dev/null 2>&1 && _metallb_ns_recovery=1
  if [[ "$ctx" == *"colima"* ]] && [[ "$_metallb_ns_recovery" == "1" ]] && [[ -f "$REPO_ROOT/infra/k8s/loadbalancer.yaml" ]]; then
    kubectl apply -f "$REPO_ROOT/infra/k8s/loadbalancer.yaml" --request-timeout=25s 2>/dev/null && ok "Recovery: caddy-h3 LoadBalancer (loadbalancer.yaml)" || true
  elif [[ "${METALLB_ENABLED:-0}" != "1" ]] && [[ -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" ]]; then
    kubectl apply -f "$REPO_ROOT/infra/k8s/caddy-h3-service-nodeport.yaml" --request-timeout=25s 2>/dev/null && ok "Recovery: caddy-h3-service-nodeport" || true
  fi
  sleep "${APPLY_RATE_LIMIT_SLEEP:-2}"
  for deploy in $BASELINE_DEPLOYS; do _scale_one "$deploy"; done
  for ex in nginx-exporter haproxy-exporter; do _scale_one "$ex"; done
  _scale_one "envoy-test" "envoy-test"
  _scale_one "caddy-h3" "ingress-nginx" 2
  # 4a1. Re-apply hostAliases and registry images after recovery (apply -k base overwrites deployment spec and can set image to short name e.g. analytics-service:dev).
  if [[ "$ctx" == *"k3d"* ]]; then
    _apply_k3d_host_aliases
    _reapply_k3d_registry_images
  elif [[ "$ctx" == *"colima"* ]]; then
    _apply_colima_host_aliases
  fi
  if [[ "$ctx" == *"k3d"* ]]; then
    # Re-patch Caddy and Envoy to tcpdump images (registry) so both keep tcpdump preinstalled
    _reg_name="k3d-off-campus-housing-tracker-registry"
    if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
      kubectl set image "deployment/caddy-h3" -n ingress-nginx "caddy=${_reg_name}:5000/caddy-with-tcpdump:dev" --request-timeout=10s 2>/dev/null && \
      kubectl patch deployment caddy-h3 -n ingress-nginx --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null && \
      ok "caddy-h3 re-patched to caddy-with-tcpdump:dev (both pods tcpdump)" || true
    fi
    if docker image inspect envoy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment envoy-test -n envoy-test --request-timeout=5s >/dev/null 2>&1; then
      kubectl set image "deployment/envoy-test" -n envoy-test "envoy=${_reg_name}:5000/envoy-with-tcpdump:dev" --request-timeout=10s 2>/dev/null && \
      kubectl patch deployment envoy-test -n envoy-test --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null && \
      ok "envoy-test re-patched to envoy-with-tcpdump:dev" || true
    fi
    ok "host.docker.internal and registry images re-applied after recovery pass"
  fi
  if [[ "$ctx" != *"k3d"* ]]; then
    # Colima/other: re-patch Caddy and Envoy to local tcpdump images (recovery apply may have reverted to default)
    if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
      kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=caddy-with-tcpdump:dev" --request-timeout=10s 2>/dev/null && \
      kubectl rollout status deployment/caddy-h3 -n ingress-nginx --timeout=90s 2>/dev/null && \
      ok "caddy-h3 re-patched to caddy-with-tcpdump:dev (Colima)" || true
    fi
    if docker image inspect envoy-with-tcpdump:dev >/dev/null 2>&1 && kubectl get deployment envoy-test -n envoy-test --request-timeout=5s >/dev/null 2>&1; then
      kubectl set image deployment/envoy-test -n envoy-test "envoy=envoy-with-tcpdump:dev" --request-timeout=10s 2>/dev/null && \
      kubectl rollout status deployment/envoy-test -n envoy-test --timeout=60s 2>/dev/null && \
      ok "envoy-test re-patched to envoy-with-tcpdump:dev (Colima)" || true
    fi
  fi
  ok "Recovery pass done"
fi
  if [[ -n "${PREFLIGHT_WRITE_LOCK_FILE:-}" ]]; then
    trap - EXIT 2>/dev/null || true
    if [[ "${PREFLIGHT_USE_MKDIR_LOCK:-0}" == "1" ]] && [[ -n "${PREFLIGHT_LOCK_DIR:-}" ]]; then
      rmdir "$PREFLIGHT_LOCK_DIR" 2>/dev/null || true
    else
      exec 200>&- 2>/dev/null || true
    fi
    echo "[PHASE 1B] WRITES (lock released)"
  fi

# 4b. Reissue already done in 3a (CA/Caddy match). Re-ensure and verify only.
say "4b. Reissue done in 3a; re-ensure API and verify Caddy next."

# 4c. Re-ensure API server ready (after reissue restarts)
if [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  say "4c. Re-ensure API server ready..."
  if ! _do_ensure; then
    warn "API server not ready after reissue. Re-run pipeline."
    exit 1
  fi
  ok "API server ready"
fi

# 4d. Verify no curl 60 (Caddy strict TLS with dev-root-ca). Phase A skips (no cert verify).
# Prefer in-cluster verify (no port-forward): when k3d or REQUIRE_COLIMA=0, use verify-caddy-strict-tls-in-cluster.sh.
# Otherwise: Colima + NodePort may need a short-lived port-forward; MetalLB on Colima can use host curl.
if ! _phase_a_only; then
  if [[ -f "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" ]] && { [[ "$ctx" == *"k3d"* ]] || [[ "${REQUIRE_COLIMA:-1}" == "0" ]]; }; then
    say "4d. Verify Caddy strict TLS in-cluster (no port-forward)..."
    chmod +x "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" 2>/dev/null || true
    _caddy_ok=0
    for _attempt in 1 2 3; do
      if "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" 2>/dev/null; then _caddy_ok=1; break; fi
      [[ $_attempt -lt 3 ]] && { warn "Caddy in-cluster verify attempt $_attempt failed; retrying in 10s..."; sleep 10; }
    done
    if [[ $_caddy_ok -ne 1 ]]; then
      warn "Caddy in-cluster strict TLS verification failed after 3 attempts. Run: pnpm run reissue. Continuing to strict TLS/mTLS preflight and suites."
    else
      ok "Caddy strict TLS verified (in-cluster)"
    fi
  elif [[ -f "$SCRIPT_DIR/verify-caddy-strict-tls.sh" ]]; then
    say "4d. Verify Caddy strict TLS (no curl exit 60)..."
    chmod +x "$SCRIPT_DIR/verify-caddy-strict-tls.sh" 2>/dev/null || true
    _pf_pid=""
    _caddy_port=""
    _caddy_target=""
    _caddy_lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    # Colima: use LoadBalancer IP when present (no NodePort/port-forward). Only use 30443 when Caddy has no LB IP.
    if [[ "$ctx" == *"colima"* ]] && [[ "${METALLB_ENABLED:-0}" != "1" ]] && [[ -z "$_caddy_lb_ip" ]]; then
      if ! nc -z 127.0.0.1 30443 2>/dev/null; then
        kubectl port-forward -n ingress-nginx svc/caddy-h3 30443:443 --request-timeout=5s 2>/dev/null & _pf_pid=$!
        sleep 5
      fi
    elif [[ "$ctx" == *"k3d"* ]]; then
      kubectl port-forward -n ingress-nginx svc/caddy-h3 8443:443 --request-timeout=5s 2>/dev/null & _pf_pid=$!
      sleep 4
      _caddy_port="8443"
      _caddy_target="127.0.0.1"
    fi
    _caddy_ok=0
    for _attempt in 1 2 3; do
      if [[ -n "$_caddy_port" ]] && [[ -n "$_caddy_target" ]]; then
        PORT="$_caddy_port" CADDY_TARGET="$_caddy_target" "$SCRIPT_DIR/verify-caddy-strict-tls.sh" 2>/dev/null && _caddy_ok=1 && break
      else
        "$SCRIPT_DIR/verify-caddy-strict-tls.sh" 2>/dev/null && _caddy_ok=1 && break
      fi
      [[ $_attempt -lt 3 ]] && { warn "Caddy verify attempt $_attempt failed; retrying in 15s..."; sleep 15; }
    done
    [[ -n "$_pf_pid" ]] && kill $_pf_pid 2>/dev/null || true
    if [[ $_caddy_ok -ne 1 ]]; then
      warn "Caddy strict TLS verification failed after 3 attempts. Run: pnpm run reissue. For NodePort, ensure 127.0.0.1:30443 is forwarded. Continuing to strict TLS/mTLS preflight and suites."
      # Don't exit: allow step 5 and suites to run; curl 60 may still occur in tests if CA/Caddy mismatch
    else
      ok "Caddy strict TLS verified"
    fi
  fi

  # 4e. k3d: verify HTTP/3 (QUIC) on NodePort from host (off-campus-housing.test + --resolve; host UDP often broken on macOS).
  if [[ "$ctx" == *"k3d"* ]] && [[ -f "$SCRIPT_DIR/lib/http3.sh" ]]; then
    _ca="$REPO_ROOT/certs/dev-root.pem"
    if [[ -s "$_ca" ]]; then
      say "4e. Verify HTTP/3 (NodePort 127.0.0.1:30443) from host (direct path)..."
      # shellcheck source=scripts/lib/http3.sh
      if source "$SCRIPT_DIR/lib/http3.sh" 2>/dev/null; then
        _h3_code="000"
        # QUIC invariant: use off-campus-housing.test URL + --resolve (no raw IP); PORT/HTTP3_RESOLVE_PORT for NodePort.
        _h3_out=$(PORT=30443 HTTP3_RESOLVE_PORT=30443 TARGET_IP=127.0.0.1 http3_curl --cacert "$_ca" -sS -o /dev/null -w "%{http_code}" --max-time 8 --http3-only \
          "https://off-campus-housing.test:30443/_caddy/healthz" 2>/dev/null) || true
        _h3_code="${_h3_out:-000}"
        if [[ "$_h3_code" == "200" ]]; then
          ok "HTTP/3 (NodePort 30443) OK — QUIC reachable from host via off-campus-housing.test:30443"
        else
          info "HTTP/3 on 30443 not available from host (code $_h3_code). Normal on macOS (NodePort UDP). Step 4f verifies HTTP/3 in-cluster; suites use HTTP/2 from host or in-cluster QUIC."
        fi
      else
        info "HTTP/3 helper not loaded; skip 30443 QUIC check. Suites will use HTTP/2."
      fi
    fi
  fi

  # 4f. Verify HTTP/3 via MetalLB IP from inside the cluster (bypasses host UDP; tests real LB path).
  if [[ "${METALLB_ENABLED:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" ]]; then
    _lb_ip=""
    _lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [[ -n "$_lb_ip" ]]; then
      say "4f. Verify HTTP/3 via MetalLB IP $_lb_ip (in-cluster; no host UDP)..."
      if TARGET_IP="$_lb_ip" HOST="off-campus-housing.test" "$SCRIPT_DIR/verify-caddy-http3-in-cluster.sh" 2>/dev/null; then
        ok "HTTP/3 via MetalLB IP $_lb_ip OK (in-cluster)"
      else
        info "HTTP/3 via MetalLB IP $_lb_ip in-cluster not 200; host path may still work for HTTP/2. Run: ./scripts/verify-caddy-http3-in-cluster.sh TARGET_IP=$_lb_ip"
        [[ "$ctx" == *"k3d"* ]] && info "  On k3d, 4e (NodePort from host) is the authoritative HTTP/3 check when 4f fails (in-cluster→LB IP UDP often limited)."
      fi
    fi
  fi

  # --- Step 5: Strict TLS/mTLS preflight (ensure-strict-tls-mtls-preflight.sh; service-tls + dev-root-ca, restart gRPC workloads) ---
  _phase_start "5_strict_tls_mtls"
  say "5. Strict TLS/mTLS preflight (service-tls + dev-root-ca; per-service cert SANs for Envoy→gRPC)..."
  chmod +x "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" 2>/dev/null || true
  if ! "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"; then
    warn "Strict TLS/mTLS preflight failed. Suites require valid service-tls and dev-root-ca."
    exit 1
  fi
  ok "Strict TLS/mTLS preflight passed"
  # Apply Envoy with per-service SNI config (ensure-strict-tls syncs secrets; apply updates ConfigMap)
  if [[ -d "$REPO_ROOT/infra/k8s/base/envoy-test" ]]; then
    kubectl apply -k "$REPO_ROOT/infra/k8s/base/envoy-test" --request-timeout=20s 2>/dev/null && ok "Envoy (per-service SNI) applied" || warn "Envoy apply skipped"
  fi
fi
# 5b. Ensure CA at repo root (single source for k6 strict TLS) — preflight syncs it; fallback from grpc-certs if missing
CA_AT_ROOT="$REPO_ROOT/certs/dev-root.pem"
if [[ -s "$CA_AT_ROOT" ]]; then
  ok "CA at repo root: certs/dev-root.pem (single source for k6; $(wc -c < "$CA_AT_ROOT") bytes)"
else
  if [[ -s /tmp/grpc-certs/ca.crt ]]; then
    mkdir -p "$REPO_ROOT/certs"
    cp -f /tmp/grpc-certs/ca.crt "$CA_AT_ROOT" 2>/dev/null && ok "CA synced to certs/dev-root.pem (from grpc-certs)" || warn "Could not sync CA to certs/dev-root.pem"
  else
    warn "certs/dev-root.pem missing; k6 will need K6_CA_CERT or re-run preflight"
  fi
fi
# Deploy manifest check (CA + leaf mounts)
"$SCRIPT_DIR/ensure-all-services-tls.sh" 2>/dev/null || warn "TLS deploy check had issues"

# 5z. Wait for pods to pass initial readiness (readiness probes use initialDelaySeconds up to 90s+)
if [[ "$PREFLIGHT_PHASE" == "full" ]]; then
  _5z="${PREFLIGHT_STEP5Z_SLEEP:-120}"
  say "5z. Waiting ${_5z}s for pods to pass initial readiness (gRPC / Kafka reconnect after TLS; override PREFLIGHT_STEP5Z_SLEEP)..."
  sleep "$_5z"
  ok "Readiness wait done"
fi

# --- Step 6: Pod health, DB, Redis (Lua), TLS secrets (per-call caps inside check) ---
_phase_start "6_pod_health_db_redis"
say "6. Pod health, DB, Redis (Lua), TLS secrets..."
KUBECTL_REQUEST_TIMEOUT=8s SKIP_PREFLIGHT=1 "$SCRIPT_DIR/check-all-pods-and-tls.sh" 2>/dev/null || warn "Pod/TLS check had issues"

# 6a. Aggressively clean up ALL rogue ReplicaSets and pods before waiting
say "6a. Aggressively cleaning up ALL rogue ReplicaSets and pods..."
CLEANUP_LOG="/tmp/cleanup-$(date +%Y%m%d-%H%M%S).log"
if [[ -f "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" ]]; then
  CLEANUP_LOG="$CLEANUP_LOG" "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" 2>&1 | tee -a "$CLEANUP_LOG" || warn "Aggressive cleanup had issues (continuing anyway)"
  ok "Cleanup log: $CLEANUP_LOG"
  # Wait a bit for cleanup to settle
  sleep 5
fi

# 6a1. Force deployments to use working ReplicaSets (if any have 0 ready)
say "6a1. Forcing deployments to use working ReplicaSets..."
if [[ -f "$SCRIPT_DIR/force-deployments-to-working-replicasets.sh" ]]; then
  "$SCRIPT_DIR/force-deployments-to-working-replicasets.sh" 2>&1 || warn "Force fix had issues (continuing anyway)"
  sleep 5
fi

# 6a2. Ensure Kafka is up before waiting (proactive, not reactive)
say "6a2. Ensuring Kafka is accessible..."
if [[ -f "$SCRIPT_DIR/ensure-kafka-ready.sh" ]]; then
  chmod +x "$SCRIPT_DIR/ensure-kafka-ready.sh"
  "$SCRIPT_DIR/ensure-kafka-ready.sh" || warn "Kafka check had issues (continuing anyway)"
else
  # Fallback
  if ! nc -z 127.0.0.1 29093 2>/dev/null; then
    warn "Kafka port 29093 not accessible, starting Kafka..."
    docker compose up -d zookeeper kafka 2>&1 | tail -5
    for i in {1..30}; do
      if nc -z 127.0.0.1 "${KAFKA_SSL_PORT:-29094}" 2>/dev/null; then
        ok "Kafka is now accessible (took ${i}s)"
        break
      fi
      sleep 2
    done
  else
    ok "Kafka is accessible"
  fi
fi

# 6b. Wait for all services to be ready before proceeding
say "6b. Waiting for all services to be ready..."
WAIT_LOG="/tmp/wait-services-$(date +%Y%m%d-%H%M%S).log"
if [[ -f "$SCRIPT_DIR/wait-for-all-services-ready.sh" ]]; then
  echo "  Detailed wait log: $WAIT_LOG"
  MAX_WAIT="${PREFLIGHT_READY_MAX_WAIT:-900}" INITIAL_WAIT="${PREFLIGHT_READY_INITIAL_WAIT:-90}" \
    WAIT_LOG="$WAIT_LOG" CLEANUP_LOG="${CLEANUP_LOG:-}" "$SCRIPT_DIR/wait-for-all-services-ready.sh" 2>&1 | tee -a "$WAIT_LOG" || {
    warn "Not all services are ready. Check logs:"
    warn "  Wait log: $WAIT_LOG"
    [[ -n "${CLEANUP_LOG:-}" ]] && warn "  Cleanup log: $CLEANUP_LOG"
    fail "Not all services are ready. Fix issues and re-run."
  }
  ok "All services ready (log: $WAIT_LOG)"
else
  warn "wait-for-all-services-ready.sh not found, skipping wait"
fi

# 6b2. Cluster health: require expected nodes Ready and print pod summary (two-node cluster + all pods ready)
# Use case and ASCII-only strings to avoid syntax errors from Unicode or [[ pattern in some shells.
say "6b2. Cluster health: nodes + pod summary..."
k3d_ctx_6b2=$(kubectl config current-context 2>/dev/null || echo "")
case "${k3d_ctx_6b2}" in
  k3d-*)
    expected_nodes="${PREFLIGHT_K3D_EXPECTED_NODES:-2}"
    node_ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2=="Ready" {c++} END {print c+0}')
    node_total=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' \n\r')
    node_ready=${node_ready//[!0-9]/}; node_ready=${node_ready:-0}
    node_total=${node_total//[!0-9]/}; node_total=${node_total:-0}
    if [[ "$node_total" -lt "$expected_nodes" ]] || [[ "$node_ready" -lt "$expected_nodes" ]]; then
      warn "Cluster nodes: $node_ready/$node_total Ready (expected $expected_nodes). Fix nodes before suites."
      kubectl get nodes 2>/dev/null || true
      fail "6b2 cluster health: not all nodes Ready."
    fi
    ok "Cluster healthy: $node_ready/$node_total nodes Ready"
    ;;
  *) ;;
esac
echo "  Pod summary (off-campus-housing-tracker, ingress-nginx, envoy-test):"
kubectl get pods -n off-campus-housing-tracker --no-headers 2>/dev/null | head -20
kubectl get pods -n ingress-nginx --no-headers 2>/dev/null | head -5
kubectl get pods -n envoy-test --no-headers 2>/dev/null | head -5
ok "6b2 cluster health and pod summary done"

# End of 3a–6b block (Phase C skips above and runs only 7 and 8).
# Single fi closes if ! _phase_c_only (line ~926). Use && group so we do not stack two fi (some environments mis-parse).
_phase_a_only && {
  ok "Phase A complete — control-plane sanity. Run Phase B for cert, then full or Phase C for load. See docs/PREFLIGHT_PHASES_README.md"
  exit 0
}
fi

# 6c. (pgbench moved to step 8 so all 8 pgbench runs come after test suites and do not block or slow earlier steps.)

# 6d. Ensure xk6-http3 binary is built when RUN_K6=1 (so k6 HTTP/3 phases run in step 7). Skip if already present or SKIP_XK6_BUILD=1.
if [[ "${RUN_K6:-0}" == "1" ]] && [[ "${SKIP_XK6_BUILD:-0}" != "1" ]]; then
  K6_HTTP3_BIN=""
  for candidate in "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.k6-build/k6-http3"; do
    if [[ -x "$candidate" ]]; then K6_HTTP3_BIN="$candidate"; break; fi
  done
  if [[ -n "$K6_HTTP3_BIN" ]]; then
    ok "xk6-http3 already built: $K6_HTTP3_BIN"
  elif [[ -f "$SCRIPT_DIR/build-k6-http3.sh" ]]; then
    say "6d. Building xk6-http3 (required for k6 HTTP/3 phases)..."
    ( cd "$REPO_ROOT" && chmod +x "$SCRIPT_DIR/build-k6-http3.sh" 2>/dev/null && "$SCRIPT_DIR/build-k6-http3.sh" 2>&1 ) && ok "xk6-http3 build done" || warn "xk6-http3 build had issues (HTTP/3 phases will be skipped if binary missing)"
  else
    warn "build-k6-http3.sh not found; HTTP/3 phases will be skipped if .k6-build/bin/k6-http3 missing"
  fi
fi

# --- Step 7: Run all test suites (auth, baseline, enhanced, adversarial, rotation, k6, standalone, tls-mtls, social); RUN_K6=1 runs k6 phases after rotation ---
# PREFLIGHT_RUN_DIR is created at script start (bench_logs/run-<stamp>/). Re-announce before suites.
if [[ "${RUN_SUITES:-1}" == "1" ]] || [[ "${RUN_PGBENCH:-0}" == "1" ]]; then
  mkdir -p "$PREFLIGHT_RUN_DIR"
  info "Preflight run output folder: $PREFLIGHT_RUN_DIR"
fi
if [[ "${RUN_SUITES:-1}" == "0" ]]; then
  say "7. Skipping test suites (RUN_SUITES=0)"
  ok "Pre-test complete. Run: RUN_SUITES=1 $SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"
  exit 0
fi

# --- Step 7 breakdown: housing + protocol test suites only ---
# run-all-test-suites.sh runs the following in order (legacy baseline/enhanced/adversarial/social/lb-coordinated removed):
#
#  Suite 1/4 — auth              → test-auth-service.sh           (housing: register, login, MFA, passkeys)
#  Suite 2/4 — rotation          → rotation-suite.sh              (CA/leaf rotation, wire-level capture, protocol verification)
#  Step 2b   — k6 load           → run-k6-phases.sh (when RUN_K6=1); strict TLS only (certs/dev-root.pem)
#  Suite 3/4 — standalone-capture → test-packet-capture-standalone.sh (gRPC + HTTP/2 + HTTP/3 wire capture only)
#  Suite 4/4 — tls-mtls          → test-tls-mtls-comprehensive.sh (cert chain, gRPC TLS, mTLS)
#  Listings + booking (HTTP/2 + HTTP/3 + edge gRPC) → test-microservices-http2-http3-housing.sh Tests 17–18 unless SKIP_* set
#  Post-suites: verify-db-and-cache-comprehensive.sh (when SKIP_END_VERIFICATION=0)

# --- Step 6e: Ensure tcpdump in Caddy + Envoy pods (so baseline/enhanced/rotation capture does not block on install) ---
# On k3d, 3c0a already patched caddy-h3 to caddy-with-tcpdump:dev so tcpdump is in the image; 6e is a no-op for those pods. Colima/other: 6e installs via apk/apt.
if [[ -f "$SCRIPT_DIR/ensure-tcpdump-in-capture-pods.sh" ]]; then
  say "6e. Ensuring tcpdump in capture pods (Caddy + Envoy)..."
  chmod +x "$SCRIPT_DIR/ensure-tcpdump-in-capture-pods.sh" 2>/dev/null || true
  _tcpdump_out=$("$SCRIPT_DIR/ensure-tcpdump-in-capture-pods.sh" 2>&1) || true
  echo "$_tcpdump_out"
  if echo "$_tcpdump_out" | grep -q "timed out\|pod(s) timed out"; then
    info "Some pods timed out; retrying ensure-tcpdump once..."
    "$SCRIPT_DIR/ensure-tcpdump-in-capture-pods.sh" 2>&1 || warn "ensure-tcpdump retry had issues (capture will install at start if needed)"
  fi
fi

_phase_start "7_run_all_suites"
say "7. Running housing + protocol test suites (auth, rotation, standalone-capture, tls-mtls; booking inside housing + k6)${RUN_K6:+ + k6}..."
if [[ "$(uname -s)" == "Darwin" ]] && command -v k6 >/dev/null 2>&1; then
  if [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ "${K6_USE_DOCKER_K6:-0}" != "1" ]]; then
    info "macOS + host k6: TLS trust comes from the login keychain (Go ignores SSL_CERT_FILE). 7a-prep will run scripts/lib/trust-dev-root-ca-macos.sh before k6, or set SKIP_MACOS_DEV_CA_TRUST=1 / K6_USE_DOCKER_K6=1."
  fi
fi
export SUITE_LOG_DIR="${SUITE_LOG_DIR:-$PREFLIGHT_RUN_DIR/suite-logs}"
mkdir -p "$SUITE_LOG_DIR"
# Explicit timeouts and verification caps so the run progresses and never hangs (override with env when calling preflight).
export CAPTURE_STOP_TIMEOUT="${CAPTURE_STOP_TIMEOUT:-30}"
export CAPTURE_MAX_STOP_SECONDS="${CAPTURE_MAX_STOP_SECONDS:-75}"
export SUITE_TIMEOUT="${SUITE_TIMEOUT:-3600}"
# Packet capture standard: (1) Host/VM: BPF (tcp|udp) dst TARGET_IP:443 if capturing before DNAT. (2) In-pod Caddy: BPF (tcp|udp) dst podIP:443, tcpdump -i eth0 (fallback any). (3) tshark: in-pod stray = udp.port==443 && ip.dst!=podIP (must 0); TARGET_IP rollup for pcaps that still show LB dst. SNI: quic && tls... contains CAPTURE_EXPECTED_SNI (default off-campus-housing.test). (4) STRICT_QUIC_VALIDATION=1 fails on pod stray / inconsistent LB rollup.
export STRICT_QUIC_VALIDATION="${STRICT_QUIC_VALIDATION:-1}"
[[ -n "${TARGET_IP:-}" ]] && export CAPTURE_V2_LB_IP="$TARGET_IP"
# Fast default: 10s DB verify cap so baseline finishes in ~2–3 min after tests (set DB_VERIFY_MAX_SECONDS=60 for full verify).
export DB_VERIFY_FAST="${DB_VERIFY_FAST:-1}"
export DB_VERIFY_MAX_SECONDS="${DB_VERIFY_MAX_SECONDS:-10}"
export DB_VERIFY_CONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT:-3}"
# If user set a higher cap, treat as full verify
[[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 30 ]] && export DB_VERIFY_FAST="${DB_VERIFY_FAST:-0}"
export RUN_SHOPPING_SEQUENCE="${RUN_SHOPPING_SEQUENCE:-0}"
# Per-suite DB verification timing (resolve_s, user1_parallel_s, etc.) for correlation with pgbench; see test-microservices-http2-http3.sh
export DB_VERIFY_TIMING_LOG="${DB_VERIFY_TIMING_LOG:-$PREFLIGHT_RUN_DIR/db-verify-timing.txt}"
# Colima + Caddy LoadBalancer: ensure run-all-test-suites uses LB IP (no NodePort). TARGET_IP = MetalLB IP (single source of truth).
_metallb_env="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
_lb_ip=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [[ -n "$_lb_ip" ]]; then
  export TARGET_IP="$_lb_ip"
  export REACHABLE_LB_IP="$_lb_ip"
  export CAPTURE_V2_LB_IP="$_lb_ip"
  export USE_LB_FOR_TESTS=1
  echo "USE_LB_FOR_TESTS=1" > "$_metallb_env"
  echo "REACHABLE_LB_IP=$_lb_ip" >> "$_metallb_env"
  echo "TARGET_IP=$_lb_ip" >> "$_metallb_env"
  echo "CAPTURE_V2_LB_IP=$_lb_ip" >> "$_metallb_env"
  echo "PORT=443" >> "$_metallb_env"
  echo "ALLOW_NODEPORT_FALLBACK=0" >> "$_metallb_env"
  export METALLB_REACHABLE_ENV="$_metallb_env"
  info "  TARGET_IP=$_lb_ip (MetalLB / caddy-h3 LoadBalancer) — suites and rotation use this IP; packet capture BPF dst host $_lb_ip:443"
  if [[ "$ctx" == *"colima"* ]]; then
    info "  Colima: Caddy has LB IP $_lb_ip → suites will use LoadBalancer only (no NodePort)"
  fi
fi
[[ "$ctx" == *"k3d"* ]] && info "  (k3d: run-all-test-suites.sh will use NodePort 30443 if reachable for HTTP/2+HTTP/3, else port-forward 8443 for HTTP/2 only)"
info "  SUITE_TIMEOUT=${SUITE_TIMEOUT}s per suite | DB_VERIFY_MAX_SECONDS=${DB_VERIFY_MAX_SECONDS}s | DB_VERIFY_FAST=${DB_VERIFY_FAST:-0} | CAPTURE_STOP_TIMEOUT=${CAPTURE_STOP_TIMEOUT}s (set to 0 for no suite cap)"
info "  Suite 2/4 (rotation): packet capture; ROTATION_H2_KEYLOG=1, ROTATE_CA=1; start/end times → $SUITE_LOG_DIR/suite-timing.txt"
info "  DB verification timing (resolve_s, user1_parallel_s, ...) → $DB_VERIFY_TIMING_LOG (for correlation with pgbench)"
# Rotation defaults: ROTATION_H2_KEYLOG=1 (decrypted HTTP/2 frames), ROTATE_CA=1 (full cert chain test)
export ROTATION_H2_KEYLOG="${ROTATION_H2_KEYLOG:-1}"
export ROTATE_CA="${ROTATE_CA:-1}"
# Colima rotation diagnostics (docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md section 7b): UDP stats + BBR wired in so you don't forget.
# ROTATION_UDP_STATS=1: capture netstat/ss/proc from Caddy pods and Colima VM before/after k6 (QUIC queue pressure).
# ROTATION_USE_BBR=1: switch Colima VM TCP congestion to BBR before suites (better H2 throughput, lower p99).
[[ "$ctx" == *"colima"* ]] && export ROTATION_UDP_STATS="${ROTATION_UDP_STATS:-1}" || export ROTATION_UDP_STATS="${ROTATION_UDP_STATS:-0}"
export ROTATION_USE_BBR="${ROTATION_USE_BBR:-1}"
[[ "${ROTATION_UDP_STATS:-0}" == "1" ]] && info "  ROTATION_UDP_STATS=1: UDP stats (netstat/ss) pre/post k6 → \$WIRE_CAPTURE_DIR (set 0 to skip)"
[[ "${ROTATION_USE_BBR:-0}" == "1" ]] && [[ "$ctx" == *"colima"* ]] && info "  ROTATION_USE_BBR=1: will set net.ipv4.tcp_congestion_control=bbr in Colima VM before suites (set 0 to skip)"

# 7a. Colima: UDP buffers + BBR (Step 8 engineering plan). Reduces QUIC packet receive errors.
# COLIMA_QUIC_SYSCTL=0 to skip; ROTATION_USE_BBR=0 skips BBR but still applies UDP buffers.
if [[ "${COLIMA_QUIC_SYSCTL:-1}" == "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/colima-quic-sysctl.sh" ]]; then
  say "7a. Colima: applying QUIC sysctls (UDP buffers + BBR)..."
  [[ "${ROTATION_USE_BBR:-0}" != "1" ]] && export COLIMA_QUIC_SKIP_BBR=1 || true
  chmod +x "$SCRIPT_DIR/colima-quic-sysctl.sh" 2>/dev/null || true
  "$SCRIPT_DIR/colima-quic-sysctl.sh" || warn "colima-quic-sysctl.sh had issues (continuing)"
fi

# Before any host k6 (phases or edge grid): macOS must trust dev-root in Keychain — see header "macOS + host k6".
_preflight_ensure_macos_k6_keychain_trust() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" == "1" ]] && {
    info "SKIP_MACOS_DEV_CA_TRUST=1 — skipping login keychain dev-root (host k6 must already trust the CA)."
    return 0
  }
  [[ "${K6_USE_DOCKER_K6:-0}" == "1" ]] && command -v docker >/dev/null 2>&1 && {
    info "K6_USE_DOCKER_K6=1 + Docker on PATH — edge k6 smoke can use Linux k6 + SSL_CERT_FILE; skipping macOS keychain step here."
    return 0
  }
  command -v k6 >/dev/null 2>&1 || return 0
  local _need_host_k6=0
  [[ "${RUN_K6:-0}" == "1" ]] && _need_host_k6=1
  [[ "${RUN_MESSAGING_LOAD:-1}" != "0" ]] && [[ "${RUN_K6_SERVICE_GRID:-1}" != "0" ]] && _need_host_k6=1
  [[ "$_need_host_k6" == "0" ]] && return 0
  local _ca="${PREFLIGHT_MACOS_K6_CA:-$REPO_ROOT/certs/dev-root.pem}"
  [[ -f "$_ca" ]] || {
    warn "macOS k6 prep: CA missing at $_ca — sync certs first"
    return 0
  }
  [[ -f "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" ]] || {
    warn "macOS k6 prep: scripts/lib/trust-dev-root-ca-macos.sh missing"
    return 0
  }
  chmod +x "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" 2>/dev/null || true
  say "7a-prep (macOS). Host k6 ignores SSL_CERT_FILE for TLS — trusting dev-root in login keychain (re-run after CA rotation)."
  info "  Same as: ./scripts/lib/trust-dev-root-ca-macos.sh \"$_ca\""
  if ! "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$_ca"; then
    if [[ "${PREFLIGHT_STRICT_MACOS_K6_TRUST:-1}" == "1" ]]; then
      say "Preflight stopped: macOS keychain trust is required for host k6 → https://off-campus-housing.test"
      say "  Fix: run ./scripts/lib/trust-dev-root-ca-macos.sh \"$_ca\""
      say "  Or: K6_USE_DOCKER_K6=1, SKIP_MACOS_DEV_CA_TRUST=1 (already trusted), or PREFLIGHT_STRICT_MACOS_K6_TRUST=0 (not recommended)"
      return 1
    fi
    warn "macOS dev CA keychain trust failed — host k6 may show x509: certificate is not trusted"
  fi
  return 0
}

# Edge k6 grid + any hook using k6_suite_after_k6_block in this process (7a, limit-finder, post-grid hook).
# Defaults match run-housing-k6-edge-smoke.sh; exporting here keeps preflight self-contained. Override any var before running.
_preflight_phase_d_tail_lab_enabled() {
  case "${PREFLIGHT_PHASE_D_TAIL_LAB:-full}" in
    0 | false | no | off | skip | disabled) return 1 ;;
    *) return 0 ;;
  esac
}

_preflight_export_k6_orchestration_defaults() {
  export K6_ORCHESTRATION_VU_SCENARIO="${K6_ORCHESTRATION_VU_SCENARIO:-1}"
  export K6_SUITE_GATEWAY_DRAIN="${K6_SUITE_GATEWAY_DRAIN:-1}"
  export K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES="${K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES:-150}"
  export K6_SUITE_GATEWAY_DRAIN_INTERVAL_SEC="${K6_SUITE_GATEWAY_DRAIN_INTERVAL_SEC:-2}"
  export K6_SUITE_GATEWAY_DRAIN_TIMEOUT_SEC="${K6_SUITE_GATEWAY_DRAIN_TIMEOUT_SEC:-120}"
  export K6_SUITE_GATEWAY_DRAIN_NAME_SUBSTR="${K6_SUITE_GATEWAY_DRAIN_NAME_SUBSTR:-api-gateway}"
  export K6_SUITE_POST_DRAIN_SLEEP_SEC="${K6_SUITE_POST_DRAIN_SLEEP_SEC:-10}"
  export K6_SUITE_KILL_K6_AFTER_BLOCK="${K6_SUITE_KILL_K6_AFTER_BLOCK:-1}"
  export K6_SUITE_POST_KILL_K6_SLEEP_SEC="${K6_SUITE_POST_KILL_K6_SLEEP_SEC:-0}"
  export K6_SUITE_COOLDOWN_SEC="${K6_SUITE_COOLDOWN_SEC:-15}"
  export K6_SUITE_CAR_EXTRA_SEC="${K6_SUITE_CAR_EXTRA_SEC:-20}"
}

# Do not skip strict TLS/mTLS preflight — always run ensure-strict-tls-mtls-preflight so all tests use strict TLS/mTLS
_run_all_suites() {
  _preflight_ensure_macos_k6_keychain_trust || return 1
  if [[ -z "${K6_SUITE_RESOURCE_LOG:-}" ]] && [[ "${K6_SUITE_RESOURCE_LOG_AUTO:-1}" == "1" ]]; then
    export K6_SUITE_RESOURCE_LOG="${K6_SUITE_RESOURCE_LOG:-$PREFLIGHT_RUN_DIR/k6-suite-resources.log}"
    mkdir -p "$(dirname "$K6_SUITE_RESOURCE_LOG")"
    {
      echo "# k6 suite resource log — kubectl top snapshots (suite contention evidence)"
      echo "# started $(date -Iseconds)"
      echo "# PREFLIGHT_RUN_DIR=${PREFLIGHT_RUN_DIR:-}"
      echo "# PREFLIGHT_MAIN_LOG=${PREFLIGHT_MAIN_LOG:-}"
    } >>"$K6_SUITE_RESOURCE_LOG"
  fi
  if [[ "${K6_SUITE_STABILITY_AGGRESSIVE:-0}" == "1" ]]; then
    export K6_SUITE_RESTART_ENVOY_AFTER_CAR="${K6_SUITE_RESTART_ENVOY_AFTER_CAR:-1}"
    info "K6_SUITE_STABILITY_AGGRESSIVE=1 → K6_SUITE_RESTART_ENVOY_AFTER_CAR=${K6_SUITE_RESTART_ENVOY_AFTER_CAR}"
  fi
  [[ -n "${K6_SUITE_RESOURCE_LOG:-}" ]] && info "k6 kubectl top snapshots also appended to: $K6_SUITE_RESOURCE_LOG"
  if [[ -f "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh" ]]; then
    # shellcheck source=lib/k6-suite-resource-hooks.sh
    source "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh"
  fi
  _preflight_export_k6_orchestration_defaults
  info "k6 load-lab orchestration (preflight defaults; override with env): K6_ORCHESTRATION_VU_SCENARIO=${K6_ORCHESTRATION_VU_SCENARIO} K6_SUITE_GATEWAY_DRAIN=${K6_SUITE_GATEWAY_DRAIN} K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES=${K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES} K6_SUITE_POST_DRAIN_SLEEP_SEC=${K6_SUITE_POST_DRAIN_SLEEP_SEC} K6_SUITE_KILL_K6_AFTER_BLOCK=${K6_SUITE_KILL_K6_AFTER_BLOCK} K6_SUITE_POST_KILL_K6_SLEEP_SEC=${K6_SUITE_POST_KILL_K6_SLEEP_SEC}"
  export SKIP_PREFLIGHT=1 SKIP_FULL_PREFLIGHT=1 RUN_K6="${RUN_K6:-0}" RUN_PGBENCH=0
  export SUITE_LOG_DIR DB_VERIFY_TIMING_LOG RUN_SHOPPING_SEQUENCE CAPTURE_STOP_TIMEOUT CAPTURE_MAX_STOP_SECONDS
  export SUITE_TIMEOUT DB_VERIFY_MAX_SECONDS DB_VERIFY_CONNECT_TIMEOUT DB_VERIFY_FAST
  export ROTATION_H2_KEYLOG="${ROTATION_H2_KEYLOG:-0}" ROTATE_CA="${ROTATE_CA:-1}" ROTATION_UDP_STATS="${ROTATION_UDP_STATS:-0}"
  export METALLB_ENABLED="${METALLB_ENABLED:-0}"
  export STRICT_QUIC_VALIDATION="${STRICT_QUIC_VALIDATION:-1}"
  [[ -n "${TARGET_IP:-}" ]] && export CAPTURE_V2_LB_IP="$TARGET_IP"
  # Ensure TARGET_IP = MetalLB IP when caddy-h3 is LoadBalancer (so run-all and rotation use same IP)
  if [[ -z "${TARGET_IP:-}" ]] && kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
    _lb=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    [[ -n "$_lb" ]] && export TARGET_IP="$_lb" && export REACHABLE_LB_IP="$_lb" && export USE_LB_FOR_TESTS=1 && export CAPTURE_V2_LB_IP="$_lb"
  fi
  say "7a0. Verifying required Deployments (housing + envoy + caddy; listings/trust/analytics must exist for full stack)…"
  chmod +x "$SCRIPT_DIR/verify-required-housing-pods.sh" 2>/dev/null || true
  HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" PREFLIGHT_APP_DEPLOYS="${PREFLIGHT_APP_DEPLOYS:-}" \
    "$SCRIPT_DIR/verify-required-housing-pods.sh" || return 1
  say "7a0b. Event-layer verification (outbox / idempotency contract)…"
  pnpm -C "$REPO_ROOT/services/event-layer-verification" test || return 1
  say "7a. Running service Vitest suites (messaging-service + media-service tests/)..."
  pnpm -C "$REPO_ROOT/services/messaging-service" test || return 1
  pnpm -C "$REPO_ROOT/services/media-service" test || return 1
  # Housing + messaging edge suites: by default skip redundant banner + ensure-messaging-schema (psql spam every preflight).
  if [[ "${PREFLIGHT_VERBOSE_HOUSING_MESSAGING_SUITE:-0}" == "1" ]]; then
    "$SCRIPT_DIR/test-microservices-http2-http3-housing.sh" || return 1
    "$SCRIPT_DIR/test-messaging-service-comprehensive.sh" || return 1
  else
    ( export SKIP_HOUSING_HTTP_SUITE_DONE_BANNER=1
      "$SCRIPT_DIR/test-microservices-http2-http3-housing.sh" ) || return 1
    ( export SKIP_ENSURE_MESSAGING_SCHEMA=1
      "$SCRIPT_DIR/test-messaging-service-comprehensive.sh" ) || return 1
  fi
  # k6: full per-service edge grid (health + public + messaging + media + event-layer + booking/search JWT flows).
  if [[ "${RUN_MESSAGING_LOAD:-1}" != "0" ]] && [[ "${RUN_K6_SERVICE_GRID:-1}" != "0" ]] && command -v k6 >/dev/null 2>&1; then
    _k6_ca="$REPO_ROOT/certs/dev-root.pem"
    [[ ! -f "$_k6_ca" ]] && _k6_ca="${K6_CA_CERT:-}"
    if [[ -f "$_k6_ca" ]] && [[ -s "$_k6_ca" ]]; then
      say "7a3–7a7. k6 per-service edge smoke (run-housing-k6-edge-smoke.sh; hostname + SSL_CERT_FILE, no K6_RESOLVE)…"
      export SSL_CERT_FILE="$_k6_ca"
      export K6_TLS_CA_CERT="$_k6_ca"
      export K6_CA_ABSOLUTE="$_k6_ca"
      export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
      chmod +x "$SCRIPT_DIR/run-housing-k6-edge-smoke.sh" 2>/dev/null || true
      _smoke_rc=0
      K6_SMOKE_DURATION="${K6_SMOKE_DURATION:-${K6_MESSAGING_DURATION:-28s}}" K6_SMOKE_VUS="${K6_SMOKE_VUS:-${K6_MESSAGING_VUS:-6}}" \
        K6_BOOKING_DURATION="${K6_BOOKING_DURATION:-25s}" K6_BOOKING_VUS="${K6_BOOKING_VUS:-3}" \
        K6_SEARCH_DURATION="${K6_SEARCH_DURATION:-28s}" K6_SEARCH_VUS="${K6_SEARCH_VUS:-6}" \
        "$SCRIPT_DIR/run-housing-k6-edge-smoke.sh" || _smoke_rc=$?
      # Exit 3 = k6_suite_check_node_cpu (node CPU% ≥ K6_SUITE_NODE_CPU_MAX) — cluster contention, not a single-service code bug.
      if [[ "$_smoke_rc" -eq 3 ]]; then
        fail "Step 7a k6 service grid: node CPU ≥ ${K6_SUITE_NODE_CPU_MAX:-85}% after a k6 block (hooks). Second terminal: kubectl top nodes. Or K6_SUITE_FAIL_ON_NODE_CPU=0 for warn-only."
      fi
      [[ "$_smoke_rc" -ne 0 ]] && warn "k6 edge smoke had failures (rc=${_smoke_rc}; strict: K6_GRID_STRICT=1)"
      # Full grid finished: extra kubectl top + 15s cooldown (+ CAR extras already inside smoke) so pools/Envoy settle before Playwright.
      if declare -F k6_suite_after_k6_block >/dev/null 2>&1; then
        k6_suite_after_k6_block "preflight-after-k6-service-grid" 0 || {
          _grid_hook=$?
          if [[ "$_grid_hook" -eq 3 ]]; then
            fail "After full k6 service grid: node CPU ≥ ${K6_SUITE_NODE_CPU_MAX:-85}% — treat as cluster-level contention (Colima scheduling, socket/IO). K6_SUITE_FAIL_ON_NODE_CPU=0 to continue."
          fi
          return "$_grid_hook"
        }
      fi
    else
      warn "7a3 k6 grid skipped: need non-empty CA at certs/dev-root.pem (sync from preflight)"
    fi
  elif [[ "${RUN_MESSAGING_LOAD:-1}" != "0" ]] && [[ "${RUN_K6_SERVICE_GRID:-1}" != "0" ]]; then
    info "7a3 k6 skipped: k6 not on PATH (install: brew install k6; or RUN_MESSAGING_LOAD=0 / RUN_K6_SERVICE_GRID=0)"
  fi
  # Phase D (Issues 9 & 10): tail latency + dual-service k6 + EXPLAIN (+ optional cross-service isolation when TAIL_LAB=full).
  if _preflight_phase_d_tail_lab_enabled; then
    say "7a7a. Phase D tail lab (run-preflight-phase-d-tail-lab.sh) — PREFLIGHT_PHASE_D_TAIL_LAB=${PREFLIGHT_PHASE_D_TAIL_LAB}"
    chmod +x "$SCRIPT_DIR/perf/run-preflight-phase-d-tail-lab.sh" 2>/dev/null || true
    export PREFLIGHT_PHASE_D_TAIL_LAB
    export PREFLIGHT_PHASE_D_OUT="${PREFLIGHT_PHASE_D_OUT:-$PREFLIGHT_RUN_DIR/phase-d}"
    _pd_rc=0
    SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}" \
      PREFLIGHT_PHASE_D_OUT="$PREFLIGHT_PHASE_D_OUT" \
      "$SCRIPT_DIR/perf/run-preflight-phase-d-tail-lab.sh" || _pd_rc=$?
    if [[ "$_pd_rc" -ne 0 ]]; then
      warn "Phase D tail lab exited $_pd_rc (non-fatal; artifacts: ${PREFLIGHT_PHASE_D_OUT})"
    else
      info "Phase D tail lab artifacts: ${PREFLIGHT_PHASE_D_OUT}"
    fi
    if declare -F k6_suite_after_k6_block >/dev/null 2>&1; then
      k6_suite_after_k6_block "preflight-after-phase-d-tail-lab" 0 || true
    fi
  fi
  # Optional: messaging capacity envelope (long; ramping-arrival-rate). Uses k6-strict-edge-tls.js. Default off.
  if [[ "${RUN_MESSAGING_LOAD:-1}" != "0" ]] && [[ "${PREFLIGHT_K6_MESSAGING_LIMIT_FINDER:-0}" == "1" ]] && command -v k6 >/dev/null 2>&1; then
    _lf_ca="$REPO_ROOT/certs/dev-root.pem"
    if [[ -f "$_lf_ca" ]] && [[ -s "$_lf_ca" ]]; then
      say "7a7b. k6 messaging limit-finder (PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1; scripts/load/k6-messaging-limit-finder.js)…"
      export SSL_CERT_FILE="$_lf_ca" K6_TLS_CA_CERT="$_lf_ca" K6_CA_ABSOLUTE="$_lf_ca"
      export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
      if declare -F k6_suite_before_k6_block >/dev/null 2>&1; then
        k6_suite_before_k6_block "preflight-k6-limit-finder" 2>/dev/null || true
      fi
      _lf_rc=0
      k6 run "$REPO_ROOT/scripts/load/k6-messaging-limit-finder.js" || _lf_rc=$?
      if declare -F k6_suite_after_k6_block >/dev/null 2>&1; then
        k6_suite_after_k6_block "preflight-after-k6-limit-finder" 0 || true
      fi
      [[ "$_lf_rc" -ne 0 ]] && warn "k6 messaging limit-finder exited $_lf_rc (non-fatal; set K6_GRID_STRICT=1 elsewhere if you need hard fail)"
    else
      warn "7a7b limit-finder skipped: missing certs/dev-root.pem"
    fi
  fi
  if [[ "${RUN_PREFLIGHT_PLAYWRIGHT:-1}" != "0" ]]; then
    say '7a8. Playwright E2E — full webapp suite (23 tests, 5 projects; see GITHUB_PR_DESCRIPTION_LISTINGS_E2E.txt)...'
    chmod +x "$SCRIPT_DIR/run-playwright-e2e-preflight.sh" 2>/dev/null || true
    "$SCRIPT_DIR/run-playwright-e2e-preflight.sh" || warn "Playwright E2E had failures (see log; set RUN_PREFLIGHT_PLAYWRIGHT=0 to skip)"
  fi
}
if ! _run_all_suites; then
  warn "One or more suites failed (continuing to step 8 if RUN_PGBENCH=1)"
fi

# Default: continue to transport study / in-cluster k6 / pgbench when enabled.
# make demo sets PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1 for a faster stop after Vitest + housing HTTP suites + Playwright.
if [[ "${PREFLIGHT_EXIT_AFTER_HOUSING_SUITES:-0}" == "1" ]]; then
  say "PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1 — stopping after step 7a (housing suites + Playwright)"
  exit 0
fi

# Transport study: always run experiments after suites (required for diagnostics). No skip option.
export TRANSPORT_STUDY=1
if [[ -f "$SCRIPT_DIR/run-transport-study-experiments.sh" ]]; then
  say "7b. Transport-layer study experiments"
  export WIRE_CAPTURE_DIR="${WIRE_CAPTURE_DIR:-$(ls -td /tmp/rotation-wire-* 2>/dev/null | head -1)}"
  [[ "${ROTATION_UDP_STATS:-0}" != "1" ]] && info "  ROTATION_UDP_STATS=0: Experiment 1 UDP drop diff will be skipped (set 1 for Colima)"
  ( set +e; TRANSPORT_STUDY=1 "$SCRIPT_DIR/run-transport-study-experiments.sh" ) || warn "Transport study had issues"
fi

# --- Step 7c: In-cluster k6 (transport isolation — Pod → Caddy ClusterIP, no host/VM in path) ---
# RUN_K6_IN_CLUSTER=1 when RUN_K6=1 (default); set RUN_K6_IN_CLUSTER=0 to skip. Requires k6-custom image in cluster (build-k6-image.sh).
if [[ "${RUN_K6:-0}" == "1" ]] && [[ "${RUN_K6_IN_CLUSTER:-1}" == "1" ]] && [[ -f "$SCRIPT_DIR/run-k6-in-cluster.sh" ]]; then
  say '7c. In-cluster k6 (transport isolation: Pod → Caddy ClusterIP)'
  info "  Ensures k6-ca-cert ConfigMap; runs k6 Job with no LB IP (ClusterIP only). See docs/ROTATION_RUNBOOK_CA_LEAF.md."
  ( set +e; DURATION="${K6_IN_CLUSTER_DURATION:-30s}" "$SCRIPT_DIR/run-k6-in-cluster.sh" ) || warn "In-cluster k6 had issues (check k6-custom image and k6-load namespace)"
  if [[ -f "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh" ]]; then
    # shellcheck source=lib/k6-suite-resource-hooks.sh
    source "$SCRIPT_DIR/lib/k6-suite-resource-hooks.sh"
    k6_suite_after_k6_block "k6-in-cluster" 0 || {
      _ick=$?
      if [[ "$_ick" -eq 3 ]]; then
        fail "Step 7c in-cluster k6: node CPU ≥ ${K6_SUITE_NODE_CPU_MAX:-85}% after hook — same contention story as edge grid. K6_SUITE_FAIL_ON_NODE_CPU=0 for warn-only."
      fi
      warn "k6 suite hook after in-cluster k6 returned ${_ick}"
    }
  fi
else
  [[ "${RUN_K6_IN_CLUSTER:-1}" == "0" ]] && info "7c. In-cluster k6 skipped (RUN_K6_IN_CLUSTER=0)"
fi

# --- Step 8: All 7 housing pgbench sweeps (cold-first then warm), EXPLAIN, observation-deck summary. RUN_PGBENCH=1 ---
# Housing DBs: ports 5441–5447 (auth, listings, bookings, messaging, notification, trust, analytics).
# PGBENCH_PARALLEL=1 (default) runs the 7 sweeps in parallel; set 0 for sequential.
if [[ "${RUN_PGBENCH:-0}" == "1" ]]; then
  mkdir -p "$PREFLIGHT_RUN_DIR"
  PGBENCH_PARALLEL="${PGBENCH_PARALLEL:-1}"
  say "8. Running all 7 housing pgbench sweeps (ports 5441–5447; cold-first then warm; real cold=restart Postgres when COLD_POSTGRES_RESTART=1; mode=${PGBENCH_MODE:-deep}, parallel=${PGBENCH_PARALLEL})..."
  PGBENCH_MODE="${PGBENCH_MODE:-deep}"
  PGBENCH_LOG="$PREFLIGHT_RUN_DIR/pgbench-combined.log"
  failed_pgbench=0
  export COLD_FIRST=1
  export RUN_COLD_CACHE=true
  export REAL_COLD_CACHE="${REAL_COLD_CACHE:-1}"
  export COLD_POSTGRES_RESTART="${COLD_POSTGRES_RESTART:-1}"
  export PGBENCH_RANDOMIZED="${PGBENCH_RANDOMIZED:-1}"

  # --- Clear terminal summary: which DB, port we are testing (housing 7) ---
  echo ""
  echo "  PGBENCH TARGETS — housing 7 (host: ${PGHOST:-127.0.0.1})"
  echo "  ┌──────────────────┬──────┬──────────────────┬─────────────────────────────┐"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "Sweep" "Port" "Database" "Schema(s)"
  echo "  ├──────────────────┼──────┼──────────────────┼─────────────────────────────┤"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "auth"             "5441" "auth"             "auth"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "listings"         "5442" "listings"         "listings"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "bookings"         "5443" "bookings"         "bookings"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "messaging"        "5444" "messaging"        "messaging"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "notification"     "5445" "notification"     "notification"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "trust"            "5446" "trust"            "trust"
  printf "  │ %-16s │ %4s │ %-16s │ %-27s │\n" "analytics"        "5447" "analytics"        "analytics"
  echo "  └──────────────────┴──────┴──────────────────┴─────────────────────────────┘"
  echo ""

  # Postgres is external (Docker Compose, host 5441–5447); not in-cluster.
  _pg_settings_query="SELECT name, setting, unit FROM pg_settings WHERE name IN ('work_mem','shared_buffers','effective_cache_size','random_page_cost','max_connections','jit','synchronous_commit','statement_timeout','lock_timeout') ORDER BY name;"
  for _port in 5441 5442 5443 5444 5445 5446 5447; do
    case "$_port" in
      5441) _db=auth ; _name=auth ;;
      5442) _db=listings ; _name=listings ;;
      5443) _db=bookings ; _name=bookings ;;
      5444) _db=messaging ; _name=messaging ;;
      5445) _db=notification ; _name=notification ;;
      5446) _db=trust ; _name=trust ;;
      5447) _db=analytics ; _name=analytics ;;
      *) _db=postgres ; _name="port$_port" ;;
    esac
    if PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${PGHOST:-127.0.0.1}" -p "$_port" -U postgres -d "$_db" -tAc "SELECT 1" >/dev/null 2>&1; then
      echo "  --- Port $_port ($_name) | database=$_db ---"
      PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${PGHOST:-127.0.0.1}" -p "$_port" -U postgres -d "$_db" -c "$_pg_settings_query" 2>/dev/null | sed 's/^/    /' || true
    else
      echo "  --- Port $_port ($_name) | database=$_db --- (not reachable)"
    fi
  done
  echo ""

  _pgbench_target_line() {
    case "$1" in
      auth)             echo "  [auth]             port=5441 db=auth             schema=auth" ;;
      listings)          echo "  [listings]         port=5442 db=listings         schema=listings" ;;
      bookings)          echo "  [bookings]         port=5443 db=bookings         schema=bookings" ;;
      messaging)         echo "  [messaging]        port=5444 db=messaging        schema=messaging" ;;
      notification)      echo "  [notification]     port=5445 db=notification     schema=notification" ;;
      trust)             echo "  [trust]            port=5446 db=trust            schema=trust" ;;
      analytics)         echo "  [analytics]        port=5447 db=analytics        schema=analytics" ;;
      *)                 echo "  [$1] running..." ;;
    esac
  }

  _pgbench_one() {
    local name=$1
    local port=$2
    local db=$3
    local script=$4
    shift 4
    local logfile="$PREFLIGHT_RUN_DIR/$name.log"
    export RECORDS_DB_PORT="$port" RECORDS_DB_NAME="$db"
    if [[ "$PGBENCH_PARALLEL" == "1" ]]; then
      ( "$SCRIPT_DIR/$script" "$@" >> "$logfile" 2>&1 ) || return 1
    else
      _pgbench_target_line "$name"
      say "  $name..."
      ( "$SCRIPT_DIR/$script" "$@" 2>&1 | tee "$logfile" | tee -a "$PGBENCH_LOG" ) || return 1
    fi
  }

  # Housing 7: single run_pgbench_sweep.sh per DB with RECORDS_DB_PORT / RECORDS_DB_NAME
  HOUSING_SWEEPS="auth:5441:auth listings:5442:listings bookings:5443:bookings messaging:5444:messaging notification:5445:notification trust:5446:trust analytics:5447:analytics"
  if [[ "$PGBENCH_PARALLEL" == "1" ]]; then
    say "  Starting 7 housing pgbench sweeps in parallel — logs: $PREFLIGHT_RUN_DIR/*.log; combined: $PGBENCH_LOG when done."
    pids=()
    for spec in $HOUSING_SWEEPS; do
      name="${spec%%:*}" rest="${spec#*:}" port="${rest%%:*}" db="${rest#*:}"
      if [[ -f "$SCRIPT_DIR/run_pgbench_sweep.sh" ]]; then
        ( RECORDS_DB_PORT="$port" RECORDS_DB_NAME="$db" MODE="$PGBENCH_MODE" _pgbench_one "$name" "$port" "$db" run_pgbench_sweep.sh ) & pids+=( $! )
      fi
    done
    for pid in "${pids[@]}"; do
      wait "$pid" || failed_pgbench=$((failed_pgbench + 1))
    done
    : > "$PGBENCH_LOG"
    for n in auth listings bookings messaging notification trust analytics; do
      [[ -f "$PREFLIGHT_RUN_DIR/$n.log" ]] && cat "$PREFLIGHT_RUN_DIR/$n.log" >> "$PGBENCH_LOG"
    done
    say "  Sweeps finished (per-sweep logs above); summary:"
    for n in auth:5441 listings:5442 bookings:5443 messaging:5444 notification:5445 trust:5446 analytics:5447; do
      name="${n%%:*}" port="${n##*:}"
      if [[ -f "$PREFLIGHT_RUN_DIR/$name.log" ]]; then
        echo "    $name (port $port) -> $PREFLIGHT_RUN_DIR/$name.log"
      fi
    done
  else
    : > "$PGBENCH_LOG"
    for spec in $HOUSING_SWEEPS; do
      name="${spec%%:*}" rest="${spec#*:}" port="${rest%%:*}" db="${rest#*:}"
      if [[ -f "$SCRIPT_DIR/run_pgbench_sweep.sh" ]]; then
        RECORDS_DB_PORT="$port" RECORDS_DB_NAME="$db" MODE="$PGBENCH_MODE" _pgbench_one "$name" "$port" "$db" run_pgbench_sweep.sh || failed_pgbench=$((failed_pgbench + 1))
      fi
    done
  fi

  if [[ "$failed_pgbench" -eq 0 ]]; then
    ok "All 7 housing pgbench sweeps complete (logs: $PREFLIGHT_RUN_DIR/*.log)"
  else
    warn "Some pgbench sweeps had issues (failures: $failed_pgbench); see PGBENCH_HARDENING.md"
  fi

  # EXPLAIN (ANALYZE, BUFFERS) for all 7 housing DBs/schemas — print and save into run folder
  if [[ -f "$SCRIPT_DIR/apply-tune-and-explain-all-dbs.sh" ]]; then
    say "Running EXPLAIN (ANALYZE, BUFFERS) for all 7 housing DBs/schemas (output in $PREFLIGHT_RUN_DIR/explain/)..."
    RUN_EXPLAIN_ONLY=1 EXPLAIN_DIR="$PREFLIGHT_RUN_DIR/explain" "$SCRIPT_DIR/apply-tune-and-explain-all-dbs.sh" 2>&1 | tee "$PREFLIGHT_RUN_DIR/explain-all.log" || true
    [[ -d "$PREFLIGHT_RUN_DIR/explain" ]] && ok "EXPLAIN outputs: $PREFLIGHT_RUN_DIR/explain/"
    # Print each EXPLAIN file to terminal so plans and index usage are visible
    if [[ -d "$PREFLIGHT_RUN_DIR/explain" ]]; then
      say "EXPLAIN (ANALYZE, BUFFERS) — plans and index usage (full output below)"
      for _f in "$PREFLIGHT_RUN_DIR/explain"/auth.txt "$PREFLIGHT_RUN_DIR/explain"/listings.txt "$PREFLIGHT_RUN_DIR/explain"/bookings.txt "$PREFLIGHT_RUN_DIR/explain"/messaging.txt "$PREFLIGHT_RUN_DIR/explain"/notification.txt "$PREFLIGHT_RUN_DIR/explain"/trust.txt "$PREFLIGHT_RUN_DIR/explain"/analytics.txt; do
        if [[ -f "$_f" ]]; then
          echo ""
          echo "  ========== $(basename "$_f" .txt) (DB/schema plan; Index Scan vs Seq Scan in plan) =========="
          cat "$_f" | sed 's/^/  /'
        fi
      done
      echo ""
      ok "Full EXPLAIN files also in: $PREFLIGHT_RUN_DIR/explain/"
    fi
  fi

  # Observation deck: write preflight summary + JSON into run folder (and copy latest to bench_logs for deck)
  if [[ -f "$SCRIPT_DIR/write-preflight-summary-md.sh" ]]; then
    say "Writing preflight summary and observation-deck JSON..."
    PGBENCH_LOG_DIR="$PREFLIGHT_RUN_DIR" EXPLAIN_DIR="$PREFLIGHT_RUN_DIR/explain" SUITE_LOG_DIR="${SUITE_LOG_DIR:-}" BENCH_LOGS="$PREFLIGHT_RUN_DIR" "$SCRIPT_DIR/write-preflight-summary-md.sh" 2>/dev/null || true
    if [[ -f "$PREFLIGHT_RUN_DIR/PREFLIGHT_SUMMARY.md" ]]; then
      cp -f "$PREFLIGHT_RUN_DIR/PREFLIGHT_SUMMARY.md" "$REPO_ROOT/bench_logs/PREFLIGHT_SUMMARY.md" 2>/dev/null || true
      cp -f "$PREFLIGHT_RUN_DIR/preflight-results.json" "$REPO_ROOT/bench_logs/preflight-results.json" 2>/dev/null || true
      ok "Preflight run packaged in: $PREFLIGHT_RUN_DIR (summary + JSON also in bench_logs/ for observation deck)"
    fi
  fi
fi

if [[ "${RUN_PGBENCH:-0}" != "1" ]]; then
  ok "Pre-test complete (pgbench skipped; set RUN_PGBENCH=1 for full control plane)"
  exit 0
fi
exit 0
