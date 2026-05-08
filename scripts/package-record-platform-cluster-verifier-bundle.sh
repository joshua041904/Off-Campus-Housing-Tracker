#!/usr/bin/env bash
# Record Platform tarball: cluster health score, DAG validator, cluster-doctor, bootstrap + proof wiring.
# Same porting rules as other record-platform bundles (record.test / record-platform).
#
# Output: $HOME/record-platform-och-cluster-verifier-bundle-<stamp>.tar.gz
#   CLUSTER_VERIFIER_BUNDLE_DIR=/path  — output directory (default: $HOME)
#   CLUSTER_VERIFIER_BUNDLE_KEEP_ALL=1 — do not remove prior same-prefix *.tar.gz in out dir
#   CLUSTER_VERIFIER_BUNDLE_FILE_PREFIX=name — tarball prefix (default: record-platform-och-cluster-verifier-bundle)
#
# Usage: bash scripts/package-record-platform-cluster-verifier-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${CLUSTER_VERIFIER_BUNDLE_DIR:-$HOME}"
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR not a directory: $OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="record-platform-och-cluster-verifier-bundle"
BUNDLE_FILE_PREFIX="${CLUSTER_VERIFIER_BUNDLE_FILE_PREFIX:-$TOP}"
BUNDLE="$STAGE/$TOP"
mkdir -p "$BUNDLE"

cleanup() { rm -rf "${STAGE:-}"; }
trap cleanup EXIT

copy_one() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -f "$src" ]]; then
    echo "missing required file: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

copy_tree() {
  local rel="${1%/}"
  local src="$ROOT/$rel"
  if [[ ! -d "$src" ]]; then
    echo "missing required directory: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$rel"
  cp -a "$src/." "$BUNDLE/$rel/"
}

copy_optional() {
  local rel="$1"
  local src="$ROOT/$rel"
  [[ -f "$src" ]] || return 0
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

_record_platform_rewrites() {
  local d="$1"
  find "$d" -type f \( \
    -name '*.sh' -o -name '*.py' -o -name '*.json' -o -name 'Makefile' -o -name '*.txt' -o -name '*.md' \
    -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' \
  \) -print0 | while IFS= read -r -d '' f; do
    perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"
    perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"
    perl -pi -e 's/och-quic/record-platform-quic/g' "$f"
  done
}

# --- Payload: Makefile + verifier stack + bootstrap/proof chain dependencies ---
for rel in \
  Makefile \
  scripts/package-record-platform-cluster-verifier-bundle.sh \
  scripts/cluster_health_dag.py \
  scripts/lib/och-cluster-dependency-dag.json \
  scripts/lib/och-housing-docker-services-default.sh \
  scripts/lib/kafka-broker-sans.sh \
  scripts/lib/metallb-subnet-guard.sh \
  scripts/lib/bootstrap-phase-rollbacks.sh \
  scripts/lib/bootstrap-phase-timings.sh \
  scripts/lib/och-kafka-event-topics-from-proto.sh \
  scripts/bootstrap-cluster.sh \
  scripts/colima-factory-reset.sh \
  scripts/dev-kill-all.sh \
  scripts/install-metallb-colima.sh \
  scripts/wait-for-metallb-lb-ready.sh \
  scripts/colima-api-health.sh \
  scripts/apply-kafka-kraft-staged.sh \
  scripts/kafka-refresh-tls-from-lb.sh \
  scripts/kafka-ssl-from-dev-root.sh \
  scripts/wait-for-kafka-external-lb-ips.sh \
  scripts/patch-kafka-external-metallb-pinned-ips.sh \
  scripts/create-kafka-event-topics-k8s.sh \
  scripts/verify-kafka-event-topic-partitions.sh \
  scripts/verify-cluster-kafka-three-brokers.sh \
  scripts/bring-up-external-infra.sh \
  scripts/lib/ensure-colima-docker-context.sh \
  scripts/lib/colima-kubeconfig.sh \
  scripts/restore-external-postgres-from-backup.sh \
  scripts/inspect-external-db-schemas.sh \
  scripts/backup-all-8-dbs.sh \
  scripts/strict-tls-bootstrap.sh \
  scripts/ensure-housing-cluster-secrets.sh \
  scripts/deploy-dev.sh \
  scripts/wait-for-housing-service-endpoints.sh \
  scripts/verify-deployment-integrity.sh \
  scripts/rollout-caddy.sh \
  scripts/verify-kafka-tls-sans.sh \
  scripts/validate-full-stack-proof.sh \
  scripts/validate-preflight-proof.sh \
  scripts/validate-idempotency-proof.sh \
  scripts/ensure-dev-root-ca.sh \
  scripts/kafka-runtime-sync.sh \
  scripts/verify-kafka-cluster.sh \
  scripts/verify-kafka-broker-keystore-jks.sh \
  scripts/kafka-after-rollout-verify-brokers.sh \
  scripts/kafka-auto-heal-inter-broker-tls.sh \
  scripts/kafka-tls-guard.sh \
  scripts/generate-kafka-alignment-report.py \
  scripts/tests/kafka-alignment-suite.sh \
  docs/BOOTSTRAP_STATE_MACHINE.md \
  docs/BOOTSTRAP_STATE_CONTRACT.md \
  docs/APP_RUNTIME_READINESS_BOUNDARY.md \
  docs/COLIMA_INTERRUPT_RECOVERY.md \
  docs/BOOTSTRAP_ROLLBACK_AND_VIS.md \
  infra/bootstrap_invariants.graph.json \
  infra/required_images.json \
  infra/app_runtime_services.json \
  infra/k8s/base/config/app-config.yaml \
  infra/k8s/base/ollama/deploy.yaml \
  infra/k8s/base/ollama/service.yaml \
  infra/k8s/base/ollama/kustomization.yaml \
  infra/k8s/base/ollama/hpa.yaml \
  infra/k8s/base/ollama/ollama-health-proxy/server.js \
  infra/k8s/base/analytics-service/deploy.yaml \
  infra/k8s/overlays/dev/patches/app-config-ollama-dev-lab.yaml \
  services/analytics-service/src/ollama.ts \
  services/analytics-service/src/http-server.ts \
  services/api-gateway/src/server.ts \
  services/common/src/metrics.ts \
  services/common/src/otel/interceptor-log.ts \
  services/common/src/otel/http-tracing-middleware.ts \
  services/common/src/redis.ts \
  services/common/src/redis-lua.ts \
  infra/k8s/base/kustomization.yaml \
  infra/k8s/base/api-gateway/deploy.yaml \
  infra/k8s/base/trust-service/deploy.yaml \
  infra/k8s/caddy-h3-configmap.yaml \
  infra/k8s/base/observability/prometheus-rules-ollama-worker.yaml \
  infra/k8s/overlays/dev/patches/ollama-deployment-dev-colima-resources.yaml \
  infra/k8s/overlays/dev/patches/ollama-hpa-dev-colima.yaml \
  k8s/redis.yaml \
  k8s/ollama-gateway.yaml \
  k8s/ollama-worker.yaml \
  k8s/ollama-gateway-configmap.yaml \
  k8s/ollama-worker-configmap.yaml \
  services/ollama-gateway/package.json \
  services/ollama-gateway/server.js \
  services/ollama-worker/package.json \
  services/ollama-worker/worker.js \
  infra/k8s/base/observability/grafana-deploy.yaml \
  infra/k8s/base/observability/prometheus-deploy.yaml \
  infra/k8s/overlays/dev/kustomization.yaml \
  infra/k8s/overlays/dev/patches/ollama-service-loadbalancer.yaml \
  infra/bootstrap_invariants.dot \
  infra/k8s/base/observability/grafana-dashboard-bootstrap-runtime.json \
  scripts/verify-required-images.sh \
  scripts/ensure-required-images.sh \
  scripts/verify-bootstrap-state.mjs \
  scripts/derive-bootstrap-order.mjs \
  scripts/bootstrap-phase-guard.mjs \
  scripts/export-bootstrap-phase-metrics.sh \
  scripts/notify-bootstrap-failure.sh \
  scripts/save-timing-history.sh \
  scripts/optimize-bootstrap-order.mjs \
  scripts/lib/bootstrap-graph-order.mjs \
  scripts/get-bootstrap-order.mjs \
  scripts/validate-phase-order.mjs \
  scripts/run-phase.sh \
  scripts/detect-bootstrap-regression.mjs \
  scripts/detect-critical-path-regression.mjs \
  scripts/export-bootstrap-regression-prom.sh \
  scripts/generate-grafana-dashboard.mjs \
  scripts/explain-bootstrap-failure.mjs \
  scripts/upload-grafana-dashboard.mjs \
  scripts/visualize-bootstrap.sh \
  scripts/render-bootstrap-dag-html.mjs \
  scripts/run-cold-bootstrap-with-timer.sh \
  scripts/run-with-wall-timer.sh \
  scripts/verify-ollama.sh \
  scripts/k8s-ollama-generate-smoke.sh \
  scripts/ollama-local-diag.sh \
  scripts/apply-ollama-gateway-stack.sh \
  scripts/verify-ollama-gateway.sh \
  scripts/verify-http3.sh \
  scripts/verify-google-maps.sh \
  scripts/verify-app-runtime.sh \
  scripts/report-app-runtime-cold-warm.mjs \
  scripts/validate-runtime-config.mjs \
  scripts/bootstrap-drift-detector.sh \
  scripts/ci/verify-bootstrap-state-ci.sh; do
  copy_one "$rel"
done

# --- Trace contract + cold-bootstrap image/route guards (portable with record.test / record-platform rewrites) ---
for rel in \
  scripts/verify-build-context.sh \
  scripts/bootstrap-trace-guard.sh \
  scripts/build-housing-images-parallel.sh \
  scripts/build-housing-images-k3s.sh \
  scripts/rebuild-och-images-and-rollout.sh \
  scripts/verify-route-exists.sh \
  scripts/verify-image-digest.sh \
  scripts/bootstrap-trace-guarantee.sh \
  scripts/trace-contract-test.sh \
  scripts/validate-k6-traces.sh \
  scripts/step7-generate-trace.sh \
  scripts/generate-k6-trace-dashboard.mjs \
  scripts/load/k6-trace-contract-smoke.js \
  scripts/load/k6-analytics-smoke.js \
  scripts/load/k6-trust-public.js \
  scripts/load/k6-trust-concurrency.js \
  scripts/load/k6-strict-edge-tls.js \
  scripts/load/services/trust.js \
  scripts/perf/service-envelope-manifest.tsv \
  scripts/load/k6-analytics-public.js \
  scripts/validate-trace-contract.mjs \
  scripts/lib/trace-analysis.mjs \
  scripts/compute-trace-critical-path.mjs \
  scripts/generate-trace-call-graph.mjs \
  scripts/generate-trace-weighted-graph.mjs \
  scripts/compute-trace-coverage.mjs \
  scripts/detect-missing-trace-links.mjs \
  scripts/export-trace-coverage-prom.mjs \
  scripts/export-trace-graph-prom.mjs \
  scripts/save-trace-edge-history.mjs \
  infra/trace_latency_budgets.json; do
  copy_optional "$rel"
done
if [[ -d "$ROOT/scripts/trace-validators" ]]; then
  copy_tree scripts/trace-validators
fi

if [[ -d "$ROOT/.git" ]]; then
  git -C "$ROOT" status -sb >"$BUNDLE/SOURCE_GIT_STATUS.txt" 2>/dev/null || true
  git -C "$ROOT" diff --stat >"$BUNDLE/SOURCE_GIT_DIFF_STAT.txt" 2>/dev/null || true
  {
    echo "# Paths under scripts/, infra/k8s/, k8s/, services/(api-gateway|analytics-service|common)/ with local modifications (pack-time hint for porting)."
    echo "# Compare to this tarball tree; not every modified file is bundled by design."
    git -C "$ROOT" status --porcelain 2>/dev/null | awk '{print $2}' | grep -E '^(scripts/|infra/k8s/|k8s/|services/(api-gateway|analytics-service|common)/)' || true
  } >"$BUNDLE/WORKING_TREE_PORTING_HINTS.txt" 2>/dev/null || true
fi

cat >"$BUNDLE/MANIFEST.txt" <<EOF
${BUNDLE_FILE_PREFIX} (inner folder: ${TOP})
Stamp: $STAMP
Source repo layout preserved (paths relative to bundle root).

Contents:
  Makefile — bootstrap, cold-bootstrap (workspace pnpm + cluster), cluster-doctor, detect-drift, proof targets
  docs/BOOTSTRAP_STATE_MACHINE.md — constructor vs drift vs preflight (layering)
  docs/BOOTSTRAP_STATE_CONTRACT.md — formal cold definition, invariants A–G, crypto-root spec
  docs/APP_RUNTIME_READINESS_BOUNDARY.md — readiness boundary narrative; histograms + JSONL cold/warm history
  docs/COLIMA_INTERRUPT_RECOVERY.md — Ctrl+C mid-k3s recovery; BOOTSTRAP_SKIP_COLIMA_AUTO_RECOVER; BOOTSTRAP_RESUME
  docs/BOOTSTRAP_ROLLBACK_AND_VIS.md — phase rollback hooks + visualize-bootstrap CLI/HTML
  infra/bootstrap_invariants.graph.json — canonical invariant DAG (v1.2+ includes C.images); infra/required_images.json — Colima VM Docker images before ingress rollouts; infra/app_runtime_services.json — G.app_runtime service list + backoff defaults; infra/bootstrap_invariants.dot — Graphviz export
  scripts/derive-bootstrap-order.mjs — topological allowed_order from the graph
  scripts/bootstrap-phase-guard.mjs — enter/complete/is-complete/fail vs bench_logs/bootstrap_state_progress.json (--log-file on --fail)
  scripts/lib/bootstrap-phase-timings.sh — phase wall ms JSON + bench_logs/bootstrap_errors/*.log helpers (sourced by bootstrap-cluster)
  scripts/export-bootstrap-phase-metrics.sh — timings JSON → bench_logs/bootstrap_phase_metrics.prom (critical path gauges)
  scripts/notify-bootstrap-failure.sh — BOOTSTRAP_ALERT_WEBHOOK Discord-compatible POST on phase fail
  scripts/save-timing-history.sh — append bootstrap_phase_timings.json snapshots under bench_logs/historical_timings/
  scripts/optimize-bootstrap-order.mjs — average historical ms + weighted Kahn → bench_logs/bootstrap_optimized_order.json
  scripts/lib/bootstrap-graph-order.mjs + get-bootstrap-order.mjs — Makefile BOOTSTRAP_ORDER (optimized vs baseline topo)
  scripts/validate-phase-order.mjs + run-phase.sh — linear phase guard vs bootstrap_state_progress.json
  scripts/detect-bootstrap-regression.mjs + export-bootstrap-regression-prom.sh — p95 drift + Prometheus textfile
  scripts/detect-critical-path-regression.mjs — G.app_runtime DAG critical_path_ms vs history p95 (bench_logs/app_runtime_critical_path_regression_report.json)
  scripts/generate-grafana-dashboard.mjs — bench_logs/bootstrap_grafana_dashboard.json (import or GRAFANA_URL upload)
  infra/k8s/base/observability/grafana-dashboard-bootstrap-runtime.json — Grafana file-provisioned dashboard (app_runtime DAG metrics)
  scripts/explain-bootstrap-failure.mjs — heuristic root-cause + bench_logs/bootstrap_failure_summary.{json,txt}
  scripts/upload-grafana-dashboard.mjs — POST dashboard to Grafana /api/dashboards/db (GRAFANA_URL + GRAFANA_API_KEY)
  scripts/visualize-bootstrap.sh + render-bootstrap-dag-html.mjs — DAG status (CLI + bench_logs/bootstrap_dag.html; timings + log paths)
  scripts/lib/bootstrap-phase-rollbacks.sh — rollback dispatch for bootstrap-cluster failures
  scripts/colima-factory-reset.sh — Colima factory reset (stop, delete -f, rm ~/.colima); make colima-factory-reset; used by P0 heal / FULL_WIPE / C.infra rollback
  scripts/verify-app-runtime.sh — G.app_runtime (parallel checks, CI mode, gauges + histogram _bucket/_sum/_count, JSONL history, infra/app_runtime_services.json + retries/backoff); report-app-runtime-cold-warm.mjs — cold vs warm delta report; validate-runtime-config.mjs — graph + config alignment
  scripts/run-cold-bootstrap-with-timer.sh — legacy forwarder to timed cold-bootstrap
  scripts/run-with-wall-timer.sh — Xm Ys wall timer + bench_logs/<suite>-last-timing.json for cold-bootstrap / preflight
  scripts/verify-ollama.sh — rollout + list + loopback /api/generate warmup (MetalLB Service optional via dev overlay)
  scripts/verify-http3.sh + scripts/verify-google-maps.sh — edge / Maps verification helpers
  infra/k8s/base/config/app-config.yaml — shared ConfigMap (OLLAMA_*, ANALYTICS_LISTING_FEEL_* keys used by ollama + analytics)
  infra/k8s/base/ollama/* — in-cluster LLM (deploy/service/kustomization/hpa + health-proxy); dev patch ollama-service-loadbalancer.yaml for external IP
  infra/k8s/overlays/dev/patches/app-config-ollama-dev-lab.yaml — dev overlay keep-alive pin (-1) for Colima labs
  infra/k8s/base/analytics-service/deploy.yaml + services/analytics-service/src/ollama.ts — listing-feel Ollama client (prompt + caps + normalizer)
  scripts/k8s-ollama-generate-smoke.sh, scripts/ollama-local-diag.sh — bounded in-cluster generate probe + local 11434 listener diagnostics
  scripts/load/k6-trust-public.js, scripts/load/k6-trust-concurrency.js — public trust reputation k6 (RFC-valid sample UUID)
  scripts/load/k6-strict-edge-tls.js, scripts/load/services/trust.js, scripts/perf/service-envelope-manifest.tsv, scripts/load/k6-analytics-public.js — k6 edge / service-envelope helpers
  scripts/wait-for-housing-service-endpoints.sh, scripts/verify-deployment-integrity.sh — rollout wait + integrity gate (Ollama-aware)
  services/api-gateway/src/server.ts, infra/k8s/base/api-gateway/deploy.yaml, infra/k8s/caddy-h3-configmap.yaml — gateway + edge timeouts
  services/common/src/redis.ts, services/common/src/redis-lua.ts — Redis client defaults (listing-feel / locks)
  services/analytics-service/src/http-server.ts — listing-feel HTTP route
  infra/k8s/base/kustomization.yaml, infra/k8s/base/trust-service/deploy.yaml — base apply + trust workload
  infra/k8s/overlays/dev/patches/ollama-deployment-dev-colima-resources.yaml, ollama-hpa-dev-colima.yaml — Colima Ollama sizing
  infra/k8s/base/observability/prometheus-rules-ollama-worker.yaml — scrape/rules for ollama-worker
  WORKING_TREE_PORTING_HINTS.txt — modified paths under key prefixes at pack time (if .git present)
  scripts/load/k6-analytics-smoke.js — analytics edge smoke thresholds
  scripts/verify-required-images.sh + scripts/ensure-required-images.sh — DAG C.images (Colima VM Docker vs infra/required_images.json)
  scripts/verify-bootstrap-state.mjs — machine-verifiable phase JSON (post-bootstrap / preflight / ci)
  scripts/bootstrap-drift-detector.sh — drift-report + bootstrap_drift.prom + dependency_impact from the graph
  scripts/ci/verify-bootstrap-state-ci.sh — GitHub Actions workspace+crypto gate
  scripts/cluster_health_dag.py — bootstrap P9, doctor, drift; state_contract in bootstrap-artifact.json; DAG formal block
  scripts/lib/och-cluster-dependency-dag.json — service DAG
  scripts/lib/ensure-colima-docker-context.sh, scripts/lib/colima-kubeconfig.sh — Compose/Docker alignment for bring-up-external-infra
  scripts/lib/och-kafka-event-topics-from-proto.sh — topic list for create + verify-partitions
  scripts/bootstrap-cluster.sh — Colima auto-heal, BOOTSTRAP_RESUME, rollback + --fail on colima / verify-app-runtime hard errors; P2b…P9 as before
  scripts/inspect-external-db-schemas.sh, scripts/backup-all-8-dbs.sh, scripts/restore-external-postgres-from-backup.sh — cold-bootstrap DB path
  scripts/install-metallb-colima.sh, wait-for-metallb-lb-ready.sh, colima-api-health.sh, apply-kafka-kraft-staged.sh, create-kafka-event-topics-k8s.sh, verify-kafka-event-topic-partitions.sh, verify-cluster-kafka-three-brokers.sh, kafka-refresh-tls-from-lb.sh, … — MetalLB + KRaft + topics path
  scripts/validate-*.sh — proof orchestration
  scripts/verify-kafka-tls-sans.sh — infra health + TLS SAN gate
  … plus other bootstrap-chained scripts in this archive.

  Trace / observability gates (when present in this bundle):
  scripts/trace-contract-test.sh, scripts/bootstrap-trace-guarantee.sh, scripts/bootstrap-trace-guard.sh,
  scripts/verify-build-context.sh, scripts/verify-route-exists.sh, scripts/verify-image-digest.sh,
  scripts/validate-trace-contract.mjs + scripts/trace-validators/* + scripts/lib/trace-analysis.mjs,
  infra/trace_latency_budgets.json, scripts/load/k6-trace-contract-smoke.js, scripts/validate-k6-traces.sh

  SOURCE_GIT_STATUS.txt / SOURCE_GIT_DIFF_STAT.txt — snapshot of working tree vs HEAD at pack time (if .git present)

Record Platform rewrites applied in this tarball:
  off-campus-housing.test → record.test
  off-campus-housing-tracker → record-platform

Extract:
  tar -xzf ${BUNDLE_FILE_PREFIX}-${STAMP}.tar.gz -C /path/to/patch-root
  (merge paths into a full OCH checkout or use as a porting reference)
EOF

_record_platform_rewrites "$BUNDLE"

OUT="$OUT_DIR/${BUNDLE_FILE_PREFIX}-${STAMP}.tar.gz"
(
  cd "$STAGE"
  tar -czf "$OUT" "$TOP"
)

if [[ "${CLUSTER_VERIFIER_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
  find "$OUT_DIR" -maxdepth 1 -type f -name "${BUNDLE_FILE_PREFIX}-*.tar.gz" ! -path "$OUT" -delete 2>/dev/null || true
fi

echo "✅ wrote $OUT"
ls -la "$OUT"
if command -v shasum >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && shasum -a 256 "$(basename "$OUT")" | awk '{print $1}' >"${OUT}.sha256" )
  echo "✅ sha256 → ${OUT}.sha256"
fi
