#!/usr/bin/env bash
# Bootstrap v2 — dependency-first cold rebuild (single contract). No preflight / proof.
# Formal invariants: docs/BOOTSTRAP_STATE_CONTRACT.md
#
# Phases (grouped):
#   HOST — P0–P1c+: local toolchain, dev TLS on disk, OS trust store for dev-root CA (Colima/Kubernetes only after P2).
#   CLUSTER — P2+: Kubernetes API, MetalLB, metrics-server, Compose infra, workloads, gates.
#   P0 HARD RESET (pkill + kube forward cleanup + Colima; optional full factory reset via scripts/colima-factory-reset.sh)
#   P0b Colima VM — tcpdump + tshark (L1 packet capture; strict QUIC / transport-quic-v6-v7-prove / preflight-lab)
#   P1 HOST (node 20, docker, curl HTTP3, openssl, kubectl client — no workload API assumptions)
#   P1b WORKSPACE LAB VENV (matplotlib — before P1c; invariant DAG A.workspace → B.crypto)
#   P1c LOCAL DEV TLS (openssl: DEV_CERTS_ENSURE_ONLY=1 dev-generate-certs.sh — CA + edge leaf + Kafka JKS if missing; before strict-tls-bootstrap)
#   P1c+ HOST OS — trust dev-root CA (scripts/trust-dev-root-ca-host.sh: Darwin→Keychain, Linux→ca-bundle; skip: BOOTSTRAP_SKIP_TRUST=1 or TRUST_DEV_ROOT_CA_SKIP=1 or BOOTSTRAP_SKIP_MACOS_TRUST=1)
#   P2 CONTROL PLANE (nodes + kube-system Ready; ensure ingress-nginx + envoy-test namespaces)
#   P2b METALLB (install-metallb-colima — required for KRaft per-broker LoadBalancers + TLS refresh)
#   P2c METRICS-SERVER (DAG C.metrics — kubectl apply -k infra/k8s/base/metrics-server; k3s patch; rollout; bench_logs/bootstrap.prom + headroom gauges)
#   P3 EXTERNAL INFRA (Compose Postgres/Redis/MinIO — before housing churn)
#   P4 HOUSING NS + baseline ConfigMap only (delete/recreate housing; app-config.yaml)
#   P5 TLS + SECRETS (disk guards; strict-tls-bootstrap; app-secrets; ensure-housing-cluster-secrets)
#   P5b-pre METALLB LB gate (wait-for-metallb-lb-ready: controller Available + speaker + temp LB IP)
#   P5b KAFKA KRaft (apply-kafka-kraft-staged: headless kafka + kafka-headless alias + externals → wait LB IPs → kafka-refresh-tls-from-lb SANs → PDB+SS; verify-kafka-bootstrap)
#   P5c KAFKA TOPICS + alignment (create-kafka-event-topics-k8s.sh → verify partitions → kafka-alignment-suite; before deploy-dev)
#   P5d KAFKA READINESS GATE (verify-kafka-ready.sh — all kafka-N Ready + :9093; before P6 images / P7 deploy-dev)
#   P6 IMAGES (docker image inspect || build+colima load — no age heuristics)
#   P6b DAG C.images (infra/required_images.json — host tcpdump images + docker save | colima ssh docker load before P7)
#   P7 MANIFESTS + rollouts (deploy-dev.sh, SKIP_SMOKE / SKIP_STRICT_ENVELOPE)
#   P7a OLLAMA GATEWAY STACK (k8s/ ollama-gateway + worker — apply-ollama-gateway-stack.sh; optional in-cluster redis via OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=0; skip: BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1)
#   P7b DEPLOYMENT INTEGRITY + rollout gates (verify-deployment-integrity.sh, wait-for-housing-rollouts.sh; skip: BOOTSTRAP_SKIP_DEPLOYMENT_INTEGRITY=1)
#   P8 ENDPOINT + edge + Kafka (wait endpoints, verify-ollama.sh, verify-ollama-gateway.sh, curl /readyz, verify-kafka-bootstrap)
#   P8a EDGE LATENCY SLA (probe-edge-route-latency.sh after readyz; skip: BOOTSTRAP_SKIP_EDGE_LATENCY_SLA=1)
#   P9 HEALTH SCORE + DAG + ARTIFACT (cluster_health_dag.py bootstrap)
#
# Run: BOOTSTRAP_CONFIRM=yes make bootstrap
#
# Env:
#   BOOTSTRAP_CONFIRM=yes       — required.
#   BOOTSTRAP_FULL_WIPE=1       — Colima factory reset (stop, delete -f, rm ~/.colima) + clear .build-cache before start.
#   BOOTSTRAP_SKIP_COLIMA_AUTO_RECOVER=1 — skip pre-start guard that deletes Colima when status shows a corrupted runtime (Ctrl+C mid-k3s).
#   BOOTSTRAP_SKIP_INFRA=1      — skip bring-up-external-infra.sh.
#   BOOTSTRAP_SKIP_METRICS_SERVER=1 — skip P2c metrics-server install (not recommended; preflight headroom becomes non-blocking only).
#   SKIP_METALLB=1              — skip MetalLB install (not supported for in-cluster KRaft bootstrap).
#   METALLB_* (see scripts/wait-for-metallb-lb-ready.sh) — tune rollout/LB probe timeouts if slow hardware.
#   BOOTSTRAP_SKIP_KAFKA_APPLY=1 — skip P5b + P5c (only if you apply Kafka + topics yourself before deploy-dev).
#   BOOTSTRAP_SKIP_KAFKA_TOPIC_PROVISION=1 — skip P5c only (topic create / verify / alignment); P5b still runs.
#   BOOTSTRAP_GRAPH_COMPLETE_F_WITHOUT_P5C=1 — with skip flags above, mark DAG node F.kafka_alignment complete after G (you assert alignment out-of-band).
#   VERIFY_APP_RUNTIME_CONFIG — optional path to app runtime JSON (default infra/app_runtime_services.json).
#   BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_SUITE=1 — skip alignment suite inside P5c (still creates + verifies topics).
#   BOOTSTRAP_SKIP_NS_DELETE=1 — skip housing namespace delete.
#   BOOTSTRAP_COMPOSE_DOWN=1    — docker compose down before infra up.
#   BOOTSTRAP_PRUNE_IMAGES=1    — docker image prune -af (destructive).
#   BOOTSTRAP_IMAGE_SERVICES    — override space-separated list (default: HOUSING_DOCKER_SERVICES_DEFAULT + webapp).
#   BOOTSTRAP_FORCE_REBUILD_IMAGES=1 — P6 rebuild every :dev image (ignores .build-cache/*.src.hash).
#   BOOTSTRAP_FORCE_REBUILD_APP_IMAGES=1 — alias (Makefile cold-bootstrap sets when COLD_BOOTSTRAP_REBUILD_APP_IMAGES=1).
#   BOOTSTRAP_SKIP_DOCKER_IMAGE_HASH_CACHE=1 — P6 always docker build (ignore source-hash cache).
#   VERIFY_APP_RUNTIME_PHASE=cold — cold-bootstrap sets this; P6 uses .build-cache per service (skip rebuild when sources unchanged).
#   COLD_BOOTSTRAP_REBUILD_API_GATEWAY=1 — before P6, delete .build-cache/api-gateway.src.hash so api-gateway rebuilds once (default 0).
#   BOOTSTRAP_SKIP_DOCKER_CONTEXT_VERIFY=1 — skip scripts/verify-build-context.sh before P6 docker builds.
#   BOOTSTRAP_SKIP_INGRESS_TCPDUMP_IMAGES=1 — skip P6b C.images (not recommended; caddy-h3 may ImagePullBackOff on Colima).
#   SKIP_STRICT_ENVELOPE / SKIP_SMOKE — passed to deploy-dev (defaults 1).
#   BOOTSTRAP_READYZ_MAX_ATTEMPTS — P8 curl https://…/api/readyz retries (default 45).
#   BOOTSTRAP_READYZ_SLEEP_SEC — sleep between P8 readyz attempts (default 3).
#   OCH_X_SUITE — sent with x-traffic-class:infra on P8 edge /api/readyz curl (default bash; strict gateway).
#   BOOTSTRAP_AUTO_BACKUP_8_DBS_BEFORE_COMPOSE_DOWN=1 (default when BOOTSTRAP_COMPOSE_DOWN=1) — run backup-all-8-dbs.sh before docker compose down.
#   BOOTSTRAP_AUTO_BACKUP_8_DBS_BEFORE_COMPOSE_DOWN=0 — skip that snapshot even if COMPOSE_DOWN=1.
#   BOOTSTRAP_SKIP_COLIMA_VM_CAPTURE_TOOLS=1 — skip P0b apt/apk install (not recommended; breaks strict QUIC packet gates).
#   BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_REPORT_VENV=1 — skip P1b matplotlib venv (not recommended; alignment PNG generation may skip).
#   BOOTSTRAP_SKIP_LOCAL_CRYPTO_INVARIANT=1 — skip P1c disk TLS ensure (not recommended; P5 strict-tls-bootstrap needs certs/).
#   BOOTSTRAP_SKIP_TRUST=1 — skip P1c+ host OS dev CA trust (all platforms; CI / headless).
#   BOOTSTRAP_SKIP_MACOS_TRUST=1 — legacy alias; P1c+ treats it like BOOTSTRAP_SKIP_TRUST (skip host OS trust on any platform).
#   TRUST_DEV_ROOT_CA_SKIP=1 — skip P1c+ trust (non-interactive; same family as BOOTSTRAP_SKIP_TRUST).
#   BOOTSTRAP_SKIP_PHASE_GUARD=1 — skip bootstrap-phase-guard.mjs (DAG legality). cold-bootstrap resets progress before bootstrap.
#   BOOTSTRAP_RESUME=1 — skip idempotent DAG slices already in bench_logs/bootstrap_state_progress.json (see docs/COLIMA_INTERRUPT_RECOVERY.md).
#   BOOTSTRAP_RESUME_FORCE_APP_RUNTIME_VERIFY=1 — with BOOTSTRAP_RESUME=1, still run verify-app-runtime.sh even if G.app_runtime is marked complete.
#   BOOTSTRAP_ROLLBACK_PREFLIGHT_KILL=1 — allow E.transport rollback to pkill preflight driver (dangerous; default off).
#   BOOTSTRAP_ALERT_WEBHOOK — optional URL (e.g. Discord incoming webhook); phase failure → one JSON POST (see scripts/notify-bootstrap-failure.sh).
#   BOOTSTRAP_SKIP_ALERT=1 — never POST the webhook.
#   BOOTSTRAP_SKIP_DEPLOYMENT_INTEGRITY=1 — skip P7b (verify-deployment-integrity + wait-for-housing-rollouts).
#   BOOTSTRAP_DEPLOYMENT_INTEGRITY_AUTO_HEAL=0 — P7b integrity check only (no kustomize re-apply; default 1).
#   BOOTSTRAP_SKIP_EDGE_LATENCY_SLA=1 — skip P8a probe-edge-route-latency.sh after /api/readyz succeeds.
#   BOOTSTRAP_SKIP_OLLAMA_VERIFY=1 — skip verify-ollama.sh (first model pull can take many minutes; not recommended).
#   VERIFY_OLLAMA_ROLLOUT_TIMEOUT — rollout status timeout for deployment/ollama (default 1200s).
#   BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 — skip P7a apply + P8 verify-ollama-gateway.sh (Prometheus /metrics gateway + Kafka workers).
#   OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=1 (default) — P7a skips k8s/redis.yaml; gateway/worker REDIS_URL from app-config (e.g. host :6380). Set 0 for in-cluster Redis Stack.
#   ROLLOUT_TIMEOUT_OLLAMA_GATEWAY / ROLLOUT_TIMEOUT_OLLAMA_WORKER / ROLLOUT_TIMEOUT_OLLAMA_REDIS — apply-ollama-gateway-stack.sh rollout timeouts (defaults 900/600/300s).
#   BOOTSTRAP_SKIP_TIMING_HISTORY=1 — after success, skip copying timings + optimize-bootstrap-order.mjs.
#   BOOTSTRAP_SKIP_REGRESSION_CHECK=1 — skip detect-bootstrap-regression.mjs + export-bootstrap-regression-prom.sh.
#   BOOTSTRAP_SKIP_CRITICAL_PATH_REGRESSION=1 — skip detect-critical-path-regression.mjs after G.app_runtime (app_runtime DAG p95 gate).
#   APP_RUNTIME_CRITICAL_PATH_REGRESSION_ALLOW=1 — allow critical-path regression without failing (see scripts/detect-critical-path-regression.mjs).
#   FAIL_ON_REGRESSION=1 — with enough history, exit non-zero when current timings exceed baseline p95 * REGRESSION_THRESHOLD (default 1.5).
#   REGRESSION_THRESHOLD / REGRESSION_MIN_RUNS — see scripts/detect-bootstrap-regression.mjs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
mkdir -p "$REPO_ROOT/bench_logs/bootstrap_errors"

NS="${NAMESPACE:-${HOUSING_NS:-off-campus-housing-tracker}}"
export HOUSING_NS="$NS"
export NAMESPACE="$NS"
# Workloads: set BOOTSTRAP_TRACE=1 in app ConfigMap/patch to force AlwaysOnSampler (see services/common/src/otel/start-telemetry.ts). Host-only exports here do not reach pods.

make() { command make -C "$REPO_ROOT" "$@"; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }
warn() { printf '\033[1;33m⚠️  %s\033[0m\n' "$*" >&2; }

if [[ "${BOOTSTRAP_CONFIRM:-}" != "yes" ]]; then
  bad "Set BOOTSTRAP_CONFIRM=yes (destructive cold rebuild)."
  exit 2
fi

_och_bootstrap_phase_guard() {
  [[ "${BOOTSTRAP_SKIP_PHASE_GUARD:-0}" == "1" ]] && return 0
  local _g="$REPO_ROOT/infra/bootstrap_invariants.graph.json"
  local _p="$REPO_ROOT/bench_logs/bootstrap_state_progress.json"
  [[ -f "$_g" ]] || return 0
  node "$SCRIPT_DIR/bootstrap-phase-guard.mjs" --graph "$_g" --progress "$_p" "$@" || return 1
}

if [[ -s "$REPO_ROOT/tools/kafka-contract/dist/index.js" ]]; then
  _och_bootstrap_phase_guard --complete A.workspace 2>/dev/null || true
fi

chmod +x "$SCRIPT_DIR/dev-kill-all.sh" "$SCRIPT_DIR/colima-factory-reset.sh" "$SCRIPT_DIR/trust-dev-root-ca-host.sh" "$SCRIPT_DIR/trust-dev-root-ca-linux.sh" "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$SCRIPT_DIR/bring-up-external-infra.sh" "$SCRIPT_DIR/restore-external-postgres-from-backup.sh" \
  "$SCRIPT_DIR/strict-tls-bootstrap.sh" \
  "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh" "$SCRIPT_DIR/deploy-dev.sh" "$SCRIPT_DIR/apply-ollama-gateway-stack.sh" "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh" "$SCRIPT_DIR/verify-ollama.sh" "$SCRIPT_DIR/verify-ollama-gateway.sh" \
  "$SCRIPT_DIR/verify-http3.sh" "$SCRIPT_DIR/verify-google-maps.sh" \
  "$SCRIPT_DIR/verify-deployment-integrity.sh" "$SCRIPT_DIR/wait-for-housing-rollouts.sh" "$SCRIPT_DIR/probe-edge-route-latency.sh" \
  "$SCRIPT_DIR/verify-kustomize-overlay-core-deployments.sh" "$SCRIPT_DIR/verify-deploy-manifest-drift.sh" "$SCRIPT_DIR/smart-rollout-housing-if-image-changed.sh" \
  "$SCRIPT_DIR/install-metallb-colima.sh" "$SCRIPT_DIR/apply-kafka-kraft-staged.sh" "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" \
  "$SCRIPT_DIR/wait-for-kafka-external-lb-ips.sh" "$SCRIPT_DIR/patch-kafka-external-metallb-pinned-ips.sh" \
  "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" "$SCRIPT_DIR/wait-for-metallb-lb-ready.sh" \
  "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh" "$SCRIPT_DIR/verify-kafka-event-topic-partitions.sh" \
  "$SCRIPT_DIR/verify-kafka-ready.sh" \
  "$SCRIPT_DIR/notify-bootstrap-failure.sh" "$SCRIPT_DIR/save-timing-history.sh" \
  "$SCRIPT_DIR/export-bootstrap-phase-metrics.sh" \
  "$SCRIPT_DIR/export-bootstrap-regression-prom.sh" "$SCRIPT_DIR/run-phase.sh" \
  "$SCRIPT_DIR/detect-critical-path-regression.mjs" \
  "$SCRIPT_DIR/ensure-required-images.sh" "$SCRIPT_DIR/verify-required-images.sh" "$SCRIPT_DIR/ensure-caddy-envoy-tcpdump.sh" \
  "$SCRIPT_DIR/bootstrap-metrics-server.sh" "$SCRIPT_DIR/export-node-headroom-prom.sh" 2>/dev/null || true

# shellcheck source=scripts/lib/och-housing-docker-services-default.sh
source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"
# shellcheck source=scripts/lib/bootstrap-phase-rollbacks.sh
source "$SCRIPT_DIR/lib/bootstrap-phase-rollbacks.sh"
# shellcheck source=scripts/lib/bootstrap-phase-timings.sh
source "$SCRIPT_DIR/lib/bootstrap-phase-timings.sh"

REPO_ROOT_BOOT_GRAPH="$REPO_ROOT/infra/bootstrap_invariants.graph.json"
REPO_ROOT_BOOT_PROGRESS="$REPO_ROOT/bench_logs/bootstrap_state_progress.json"

_och_node_is_complete() {
  local n="$1"
  [[ "${BOOTSTRAP_SKIP_PHASE_GUARD:-0}" == "1" ]] && return 1
  [[ -f "$REPO_ROOT_BOOT_GRAPH" ]] || return 1
  node "$SCRIPT_DIR/bootstrap-phase-guard.mjs" --graph "$REPO_ROOT_BOOT_GRAPH" --progress "$REPO_ROOT_BOOT_PROGRESS" --is-complete "$n" >/dev/null 2>&1
}

_och_bootstrap_record_fail() {
  local node="$1"
  local msg="${2:-failed}"
  local logf="${3:-}"
  [[ "${BOOTSTRAP_SKIP_PHASE_GUARD:-0}" == "1" ]] && return 0
  [[ -f "$REPO_ROOT_BOOT_GRAPH" ]] || return 0
  if [[ -n "$logf" ]]; then
    node "$SCRIPT_DIR/bootstrap-phase-guard.mjs" --graph "$REPO_ROOT_BOOT_GRAPH" --progress "$REPO_ROOT_BOOT_PROGRESS" --fail "$node" --message "$msg" --log-file "$logf" >/dev/null 2>&1 || true
  else
    node "$SCRIPT_DIR/bootstrap-phase-guard.mjs" --graph "$REPO_ROOT_BOOT_GRAPH" --progress "$REPO_ROOT_BOOT_PROGRESS" --fail "$node" --message "$msg" >/dev/null 2>&1 || true
  fi
  bash "$SCRIPT_DIR/notify-bootstrap-failure.sh" "$node" "${logf:-}" || true
}

_och_should_skip_to_post_c_infra() {
  [[ "${BOOTSTRAP_RESUME:-0}" != "1" ]] && return 1
  _och_node_is_complete C.infra || return 1
  command -v kubectl >/dev/null 2>&1 || return 1
  kubectl get nodes --request-timeout=12s >/dev/null 2>&1 || return 1
  kubectl get pods -n metallb-system --no-headers 2>/dev/null | grep -qiE 'metallb|controller|speaker' || return 1
  return 0
}

_och_prune_colima_kube() {
  kubectl config delete-context colima 2>/dev/null || true
  kubectl config delete-cluster colima 2>/dev/null || true
  kubectl config delete-user colima 2>/dev/null || true
}

# Full Colima reset (stop + delete + ~/.colima) — fixes stuck ⚠️ / wedged Lima state; see scripts/colima-factory-reset.sh.
_och_colima_factory_reset() {
  bash "$SCRIPT_DIR/colima-factory-reset.sh"
}

# Colima profile Running but status or Kubernetes API unhealthy (e.g. ^C during k3s).
_och_bootstrap_colima_heal_wedged_profile() {
  [[ "${BOOTSTRAP_SKIP_COLIMA_AUTO_RECOVER:-0}" == "1" ]] && return 0
  colima list 2>/dev/null | grep -qiE '\bRunning\b' || return 0
  local _bad=0
  if ! colima status >/dev/null 2>&1; then
    _bad=1
  elif command -v kubectl >/dev/null 2>&1; then
    local _ctx
    _ctx="$(kubectl config current-context 2>/dev/null || true)"
    if [[ "$_ctx" == "colima" ]] && ! kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
      _bad=1
    fi
  fi
  if [[ "$_bad" -ne 1 ]]; then
    return 0
  fi
  export OCH_INFRA_HEALED=1
  warn "C.infra healed (cold guarantee enforced)"
  echo "  ⚠️  Colima Running but status/API unhealthy — factory reset (stop, delete -f, rm ~/.colima)…" >&2
  _och_colima_factory_reset
}

# Colima sometimes survives Ctrl+C during k3s bring-up: VM "running" but status errors — delete + kube prune.
_och_bootstrap_colima_recover_if_corrupt() {
  [[ "${BOOTSTRAP_SKIP_COLIMA_AUTO_RECOVER:-0}" == "1" ]] && return 0
  local _st
  _st="$(colima status 2>&1 || true)"
  # Match "VM up, control-plane broken" (e.g. ^C during k3s) — not plain "colima is not running".
  if ! echo "$_st" | grep -qiE 'error retrieving|Error retrieving|retrieving runtime'; then
    return 0
  fi
  echo "  ⚠️  Colima status looks corrupted (e.g. interrupted k3s start). Auto-reset: factory reset (stop, delete -f, rm ~/.colima)…" >&2
  _och_colima_factory_reset
}

if _och_should_skip_to_post_c_infra; then
  say "[P0–P2b] BOOTSTRAP_RESUME=1 — C.infra already complete; cluster + MetalLB look healthy (skipping dev-kill-all / Colima cycle / MetalLB install)"
  command -v colima >/dev/null 2>&1 || { bad "colima not on PATH"; exit 1; }
  _nv="$(node -v 2>/dev/null || true)"
  [[ "$_nv" =~ ^v20\. ]] || { bad "Node 20.x required (got ${_nv})"; exit 1; }
  command -v docker >/dev/null 2>&1 || { bad "docker not on PATH"; exit 1; }
  docker info >/dev/null 2>&1 || { bad "docker info failed (point DOCKER_HOST at Colima if needed)"; exit 1; }
  command -v curl >/dev/null 2>&1 || { bad "curl not on PATH"; exit 1; }
  command -v openssl >/dev/null 2>&1 || { bad "openssl not on PATH"; exit 1; }
  command -v kubectl >/dev/null 2>&1 || { bad "kubectl not on PATH"; exit 1; }
  # shellcheck source=scripts/lib/ensure-colima-docker-context.sh
  source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
  export OCH_KUBE_CONTEXT="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || echo colima)}"
  och_ensure_colima_docker_context || true
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  och_export_colima_kubeconfig_prefer_reachable || true
  kubectl get nodes --request-timeout=15s
  ok "resume: kube + MetalLB assumed healthy (re-synced context)"
  if [[ "${BOOTSTRAP_SKIP_METRICS_SERVER:-0}" != "1" ]]; then
    chmod +x "$SCRIPT_DIR/bootstrap-metrics-server.sh" "$SCRIPT_DIR/export-node-headroom-prom.sh" 2>/dev/null || true
    if _och_bootstrap_phase_guard --enter C.metrics 2>/dev/null; then
      REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/bootstrap-metrics-server.sh" || warn "bootstrap-metrics-server.sh failed on resume (non-fatal)"
      _och_bootstrap_phase_guard --complete C.metrics 2>/dev/null || true
    else
      warn "bootstrap phase guard: could not enter C.metrics on resume (run a full bootstrap once with metrics-server)"
    fi
  fi
else
_BOOT_C_INFRA_START_MS="$(_och_bootstrap_ms_now)"
# --- P0 HARD RESET ---
say "[P0] HARD RESET"
bash "$SCRIPT_DIR/dev-kill-all.sh"
rm -f "${HOME}/.kube/config.colima-forward" 2>/dev/null || true

command -v colima >/dev/null 2>&1 || { bad "colima not on PATH"; exit 1; }

_och_bootstrap_colima_heal_wedged_profile
if [[ "${OCH_INFRA_HEALED:-0}" == "1" ]]; then
  OCH_INFRA_HEALED=1 bash "$SCRIPT_DIR/export-bootstrap-phase-metrics.sh" >/dev/null 2>&1 || true
  unset OCH_INFRA_HEALED
fi

if [[ "${BOOTSTRAP_FULL_WIPE:-0}" == "1" ]]; then
  echo "  ▶ BOOTSTRAP_FULL_WIPE=1 — Colima factory reset + .build-cache wipe…"
  _och_colima_factory_reset
  rm -rf "${REPO_ROOT}/.build-cache" 2>/dev/null || true
fi

_och_bootstrap_colima_recover_if_corrupt
colima stop 2>/dev/null || true
sleep 2
_och_bootstrap_colima_recover_if_corrupt
CPU="${CPU:-12}"
MEMORY="${MEMORY:-16}"
DISK="${DISK:-256}"
COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
if ! colima start --cpu "$CPU" --memory "$MEMORY" --disk "$DISK" --network-address --with-kubernetes --kubernetes-version "$COLIMA_K3S_VERSION"; then
  bad "colima start failed (k3s / VM bring-up)"
  _t1="$(_och_bootstrap_ms_now)"
  _och_bootstrap_record_phase_timing_ms C.infra "$((_t1 - _BOOT_C_INFRA_START_MS))"
  _lf="$(_och_bootstrap_write_phase_error_log C.infra colima-start)"
  { colima status 2>&1 || true; echo "---"; docker info 2>&1 | head -60 || true; } >>"$_lf"
  _och_bootstrap_record_fail C.infra "colima start failed" "$_lf"
  echo "  📄 error log: $_lf" >&2
  och_bootstrap_rollback_dispatch C.infra || true
  exit 1
fi
ok "Colima + k3s up"

# --- P0b Colima VM: L1 packet capture (tcpdump + tshark) — strict QUIC / preflight-lab ---
say "[P0b] Colima VM — tcpdump + tshark (transport / QUIC capture gates)"
if [[ "${BOOTSTRAP_SKIP_COLIMA_VM_CAPTURE_TOOLS:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_COLIMA_VM_CAPTURE_TOOLS=1 — skipping VM capture tooling (strict preflight may fail)"
else
  if ! colima ssh -- true 2>/dev/null; then
    bad "colima ssh failed — cannot verify or install VM capture tools"
    exit 1
  fi
  if colima ssh -- sh -c 'command -v tcpdump >/dev/null 2>&1 && command -v tshark >/dev/null 2>&1'; then
    ok "Colima VM already has tcpdump + tshark"
  else
    echo "  ▶ Installing tcpdump + tshark inside Colima VM (non-interactive)…"
    if colima ssh -- sh -c 'command -v apt-get >/dev/null 2>&1'; then
      colima ssh -- sudo DEBIAN_FRONTEND=noninteractive sh -c 'apt-get update -qq && apt-get install -y -qq tcpdump tshark' \
        || { bad "apt-get install tcpdump tshark failed in Colima VM"; exit 1; }
    elif colima ssh -- sh -c 'command -v apk >/dev/null 2>&1'; then
      # Alpine: wireshark pulls tshark; tcpdump is separate
      colima ssh -- sudo sh -c 'apk update -q && apk add --no-cache tcpdump wireshark' \
        || { bad "apk add tcpdump wireshark failed in Colima VM"; exit 1; }
    else
      bad "Colima VM has neither apt-get nor apk; install tcpdump + tshark manually"
      exit 1
    fi
  fi
  colima ssh -- sh -c 'command -v tcpdump >/dev/null 2>&1 && tcpdump --version >/dev/null 2>&1' || { bad "tcpdump missing or broken in Colima VM after install"; exit 1; }
  colima ssh -- sh -c 'command -v tshark >/dev/null 2>&1' || { bad "tshark missing in Colima VM after install"; exit 1; }
  ok "Colima VM: tcpdump + tshark verified"
fi

# --- P1 HOST ---
say "[P1] HOST dependencies"
_nv="$(node -v 2>/dev/null || true)"
[[ "$_nv" =~ ^v20\. ]] || { bad "Node 20.x required (got ${_nv})"; exit 1; }
ok "node $_nv"

command -v docker >/dev/null 2>&1 || { bad "docker not on PATH"; exit 1; }
_dw=0
while ! docker info >/dev/null 2>&1; do
  _dw=$((_dw + 1))
  [[ "$_dw" -le 90 ]] || { bad "docker info timeout"; exit 1; }
  echo "  ⏳ docker ($_dw/90)…"
  sleep 2
done
ok "docker info"

command -v curl >/dev/null 2>&1 || { bad "curl not on PATH"; exit 1; }
curl --version 2>/dev/null | grep -qiE 'HTTP3|HTTP/3' || { bad "curl missing HTTP3 in curl --version"; exit 1; }
ok "curl HTTP/3 capability"

command -v openssl >/dev/null 2>&1 || { bad "openssl not on PATH"; exit 1; }
openssl version >/dev/null
ok "openssl"

command -v kubectl >/dev/null 2>&1 || { bad "kubectl not on PATH"; exit 1; }
kubectl version --client >/dev/null
ok "kubectl client"

say "[P1b] Workspace lab venv (matplotlib for Kafka alignment report / suite PNGs)"
if [[ "${BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_REPORT_VENV:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_REPORT_VENV=1 — skipping make kafka-alignment-report-venv"
elif _och_node_is_complete A.workspace && [[ "${BOOTSTRAP_RESUME:-0}" == "1" ]]; then
  echo "  ⏭️  BOOTSTRAP_RESUME=1 — A.workspace already complete; skipping kafka-alignment-report-venv"
else
  _t_a0="$(_och_bootstrap_ms_now)"
  make kafka-alignment-report-venv || { bad "kafka-alignment-report-venv failed"; exit 1; }
  _och_bootstrap_record_phase_timing_ms A.workspace "$(($(_och_bootstrap_ms_now) - _t_a0))"
  ok "kafka-alignment-report venv ready"
fi

say "[P1c] Local dev TLS invariant (DEV_CERTS_ENSURE_ONLY=1 — CA + edge leaf + Kafka client/broker material if missing)"
if [[ "${BOOTSTRAP_SKIP_LOCAL_CRYPTO_INVARIANT:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_LOCAL_CRYPTO_INVARIANT=1 — skipping dev-generate-certs (strict-tls-bootstrap expects certs/ on disk)"
  _och_bootstrap_phase_guard --complete B.crypto 2>/dev/null || true
elif _och_node_is_complete B.crypto && [[ "${BOOTSTRAP_RESUME:-0}" == "1" ]]; then
  [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] || { bad "BOOTSTRAP_RESUME: B.crypto marked complete but certs/dev-root.pem missing — rerun without BOOTSTRAP_RESUME=1 or restore certs/"; exit 1; }
  echo "  ⏭️  BOOTSTRAP_RESUME=1 — B.crypto already complete; skipping dev-generate-certs (DEV_CERTS_ENSURE_ONLY)"
else
  _och_bootstrap_phase_guard --enter B.crypto || { bad "phase guard: cannot enter B.crypto (complete A.workspace first — run cold-bootstrap workspace or place tools/kafka-contract/dist)"; exit 1; }
  _t_b0="$(_och_bootstrap_ms_now)"
  DEV_CERTS_ENSURE_ONLY=1 bash "$SCRIPT_DIR/dev-generate-certs.sh" || { bad "dev-generate-certs.sh (DEV_CERTS_ENSURE_ONLY) failed"; exit 1; }
  _och_bootstrap_record_phase_timing_ms B.crypto "$(($(_och_bootstrap_ms_now) - _t_b0))"
  _och_bootstrap_phase_guard --complete B.crypto || true
  ok "local TLS material under certs/ (see scripts/dev-generate-certs.sh)"
fi

# After certs/ exists: install dev-root into the host OS trust store (macOS Keychain, Linux ca-certificates, …).
if [[ -s "$REPO_ROOT/certs/dev-root.pem" ]]; then
  if [[ "${BOOTSTRAP_SKIP_TRUST:-0}" != "1" ]] && [[ "${BOOTSTRAP_SKIP_MACOS_TRUST:-0}" != "1" ]] && [[ "${TRUST_DEV_ROOT_CA_SKIP:-0}" != "1" ]]; then
    say "[P1c+] Host OS — trust dev-root CA (platform-aware: scripts/trust-dev-root-ca-host.sh)"
    chmod +x "$SCRIPT_DIR/trust-dev-root-ca-host.sh" "$SCRIPT_DIR/trust-dev-root-ca-linux.sh" "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" 2>/dev/null || true
    if bash "$SCRIPT_DIR/trust-dev-root-ca-host.sh" "$REPO_ROOT/certs/dev-root.pem"; then
      ok "dev-root CA trust step completed for this host (or no-op on unsupported OS)"
    else
      warn "trust-dev-root-ca-host.sh did not complete — see script output. CI/headless: BOOTSTRAP_SKIP_TRUST=1"
    fi
  else
    echo "  ℹ️  BOOTSTRAP_SKIP_TRUST / BOOTSTRAP_SKIP_MACOS_TRUST / TRUST_DEV_ROOT_CA_SKIP — skipping host OS dev CA trust"
  fi
fi

# --- CLUSTER phase (Kubernetes API and beyond); HOST phase (P0–P1c+) complete for this run ---
# --- P2 CONTROL PLANE ---
say "[P2] Kubernetes control plane"
# shellcheck source=scripts/lib/ensure-colima-docker-context.sh
source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
export OCH_KUBE_CONTEXT="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || echo colima)}"
och_ensure_colima_docker_context || true
# shellcheck source=scripts/lib/colima-kubeconfig.sh
source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
och_export_colima_kubeconfig_prefer_reachable || true

_k=0
while ! kubectl get nodes --request-timeout=15s >/dev/null 2>&1; do
  _k=$((_k + 1))
  if [[ "$_k" -gt 90 ]]; then
    bad "kubectl get nodes timeout"
    _t1="$(_och_bootstrap_ms_now)"
    _och_bootstrap_record_phase_timing_ms C.infra "$((_t1 - _BOOT_C_INFRA_START_MS))"
    _lf="$(_och_bootstrap_write_phase_error_log C.infra kubectl-nodes-timeout)"
    { kubectl get nodes -o wide 2>&1 || true; kubectl get pods -A --no-headers 2>&1 | head -80 || true; } >>"$_lf"
    _och_bootstrap_record_fail C.infra "kubectl get nodes timeout after colima start" "$_lf"
    echo "  📄 error log: $_lf" >&2
    och_bootstrap_rollback_dispatch C.infra || true
    exit 1
  fi
  sleep 2
done
kubectl get nodes
ok "nodes"

_ks=0
while true; do
  _bad=0
  _ln=0
  while read -r _name _ready _st _rest; do
    [[ -z "${_name:-}" ]] && continue
    # k3s ServiceLB pods (svclb-*) may stay Pending until a LoadBalancer Service is ready — not a core control-plane gate.
    [[ "$_name" == svclb-* ]] && continue
    _ln=$((_ln + 1))
    if [[ "$_st" != "Running" && "$_st" != "Completed" ]]; then
      _bad=$((_bad + 1))
    fi
  done < <(kubectl get pods -n kube-system --no-headers 2>/dev/null || true)
  if [[ "$_ln" -gt 0 ]] && [[ "$_bad" -eq 0 ]]; then
    break
  fi
  _ks=$((_ks + 1))
  if [[ "$_ks" -gt 120 ]]; then
    bad "kube-system not healthy (pods=${_ln} notReady=${_bad})"
    _t1="$(_och_bootstrap_ms_now)"
    _och_bootstrap_record_phase_timing_ms C.infra "$((_t1 - _BOOT_C_INFRA_START_MS))"
    _lf="$(_och_bootstrap_write_phase_error_log C.infra kube-system-unhealthy)"
    kubectl get pods -n kube-system -o wide >>"$_lf" 2>&1 || true
    _och_bootstrap_record_fail C.infra "kube-system not healthy after colima start" "$_lf"
    echo "  📄 error log: $_lf" >&2
    och_bootstrap_rollback_dispatch C.infra || true
    exit 1
  fi
  echo "  ⏳ kube-system ($_ks/120) pods=${_ln} notReady=${_bad}"
  sleep 2
done
ok "kube-system"

for n in ingress-nginx envoy-test; do
  kubectl create namespace "$n" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=30s
done
ok "ingress-nginx + envoy-test namespaces"

# --- P2b METALLB ---
say "[P2b] MetalLB (L2 pool for Kafka per-broker LoadBalancers)"
if [[ "${SKIP_METALLB:-0}" == "1" ]]; then
  bad "SKIP_METALLB=1 is incompatible with in-cluster KRaft bootstrap (kafka-*-external need LoadBalancer IPs)."
  exit 1
fi
export METALLB_POOL="${METALLB_POOL:-}"
bash "$SCRIPT_DIR/install-metallb-colima.sh"
ok "MetalLB"
_och_bootstrap_phase_guard --enter C.infra || { bad "phase guard: cannot enter C.infra (complete B.crypto first)"; exit 1; }
_och_bootstrap_phase_guard --complete C.infra || true
_t_c_end="$(_och_bootstrap_ms_now)"
_och_bootstrap_record_phase_timing_ms C.infra "$((_t_c_end - _BOOT_C_INFRA_START_MS))"

# --- P2c METRICS-SERVER (DAG C.metrics — must complete before C.images) ---
if [[ "${BOOTSTRAP_SKIP_METRICS_SERVER:-0}" != "1" ]]; then
  say "[P2c] metrics-server (C.metrics — install/patch + kubectl top + node headroom → bench_logs/bootstrap.prom)"
  chmod +x "$SCRIPT_DIR/bootstrap-metrics-server.sh" "$SCRIPT_DIR/export-node-headroom-prom.sh" 2>/dev/null || true
  _och_bootstrap_phase_guard --enter C.metrics || { bad "phase guard: cannot enter C.metrics (complete C.infra first)"; exit 1; }
  REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/bootstrap-metrics-server.sh" || {
    bad "bootstrap-metrics-server.sh failed (set BOOTSTRAP_SKIP_METRICS_SERVER=1 to skip)"
    exit 1
  }
  _och_bootstrap_phase_guard --complete C.metrics || true
  ok "C.metrics — metrics-server ready"
else
  warn "BOOTSTRAP_SKIP_METRICS_SERVER=1 — skipping metrics-server install"
  mkdir -p "$REPO_ROOT/bench_logs"
  echo "# BOOTSTRAP_SKIP_METRICS_SERVER=1 at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$REPO_ROOT/bench_logs/bootstrap.prom"
  echo "bootstrap_metrics_server_ready 0" >>"$REPO_ROOT/bench_logs/bootstrap.prom"
  _och_bootstrap_phase_guard --enter C.metrics || { bad "phase guard: cannot enter C.metrics (complete C.infra first)"; exit 1; }
  _och_bootstrap_phase_guard --complete C.metrics || true
fi

fi

# --- P3 EXTERNAL INFRA ---
say "[P3] EXTERNAL INFRA (Compose)"
if [[ "${BOOTSTRAP_COMPOSE_DOWN:-0}" == "1" ]] && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
  _bk="${BOOTSTRAP_AUTO_BACKUP_8_DBS_BEFORE_COMPOSE_DOWN:-1}"
  if [[ "$_bk" == "1" ]]; then
    say "[P3-pre] All-8 Postgres backup before docker compose down (set BOOTSTRAP_AUTO_BACKUP_8_DBS_BEFORE_COMPOSE_DOWN=0 to skip)"
    chmod +x "$SCRIPT_DIR/backup-all-8-dbs.sh" 2>/dev/null || true
    bash "$SCRIPT_DIR/backup-all-8-dbs.sh" || echo "⚠️  backup-all-8-dbs.sh failed — continuing with compose down"
  fi
  (cd "$REPO_ROOT" && docker compose down) || true
fi
if [[ "${BOOTSTRAP_PRUNE_IMAGES:-0}" == "1" ]]; then
  docker image prune -af || true
fi
if [[ "${BOOTSTRAP_SKIP_INFRA:-0}" != "1" ]]; then
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  if [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
    say "[P3] RESTORE_BACKUP_DIR=${RESTORE_BACKUP_DIR} — bring-up-external-infra will restore all-8 Postgres after Compose is healthy"
  fi
  bash "$SCRIPT_DIR/bring-up-external-infra.sh"
else
  echo "  ℹ️  BOOTSTRAP_SKIP_INFRA=1 — skipping bring-up-external-infra.sh"
fi
ok "external infra"

# --- P4 HOUSING NS + app-config (no Deployments) ---
say "[P4] Housing namespace + baseline ConfigMap"
CA_PEM="$REPO_ROOT/certs/dev-root.pem"
LEAF_CRT="$REPO_ROOT/certs/off-campus-housing.test.crt"
LEAF_KEY="$REPO_ROOT/certs/off-campus-housing.test.key"
for f in "$CA_PEM" "$LEAF_CRT" "$LEAF_KEY"; do
  [[ -f "$f" ]] || { bad "missing cert file: $f"; exit 1; }
done
openssl x509 -in "$CA_PEM" -noout -subject >/dev/null || { bad "invalid CA"; exit 1; }
openssl x509 -in "$LEAF_CRT" -noout -subject >/dev/null || { bad "invalid leaf"; exit 1; }
openssl x509 -in "$LEAF_CRT" -noout -purpose 2>/dev/null | grep -qi 'SSL server' || { bad "leaf openssl -purpose (SSL server) failed"; exit 1; }
ok "disk TLS guards"

if [[ "${BOOTSTRAP_SKIP_NS_DELETE:-0}" != "1" ]]; then
  kubectl delete namespace "$NS" --ignore-not-found --wait=true --timeout=420s || true
fi
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=30s
kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" -n "$NS"
ok "housing ns + app-config"

# --- P5 TLS + app secrets ---
say "[P5] TLS + secrets (cluster material)"
bash "$SCRIPT_DIR/strict-tls-bootstrap.sh"
kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" -n "$NS"
HOUSING_NS="$NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
ok "strict-tls + app-secrets + housing secret aliases"

# --- P5b IN-CLUSTER KAFKA (KRaft) — before app images / deploy-dev ---
say "[P5b] In-cluster Kafka (KRaft + staged TLS from MetalLB)"
if [[ "${BOOTSTRAP_SKIP_KAFKA_APPLY:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_APPLY=1 — skipping Kafka apply (you must have StatefulSet/kafka + verify-kafka-bootstrap yourself)"
else
  say "[P5b-pre] MetalLB strict readiness (controller Available + speaker + probe LB)"
  bash "$SCRIPT_DIR/wait-for-metallb-lb-ready.sh"
  ok "MetalLB ready for multi-Service LoadBalancers"
  export HOUSING_NS="$NS"
  export KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
  bash "$SCRIPT_DIR/apply-kafka-kraft-staged.sh"
  make verify-kafka-bootstrap
  ok "Kafka StatefulSet + bootstrap string verified"
fi

# --- P5c KAFKA DOMAIN TOPICS + alignment (before any workload that calls ensureKafkaBrokerReady) ---
say "[P5c] Kafka event topics + partition verify + alignment suite"
if [[ "${BOOTSTRAP_SKIP_KAFKA_APPLY:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_APPLY=1 — skipping P5c (create topics + verify + alignment before deploy-dev yourself)"
elif [[ "${BOOTSTRAP_SKIP_KAFKA_TOPIC_PROVISION:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_TOPIC_PROVISION=1 — skipping P5c topic create / verify / alignment"
else
  export KAFKA_K8S_NS="$NS"
  export ENV_PREFIX="${ENV_PREFIX:-dev}"
  bash "$SCRIPT_DIR/create-kafka-event-topics-k8s.sh"
  KAFKA_PARTITION_VERIFY_TARGET=k8s KAFKA_K8S_NS="$NS" bash "$SCRIPT_DIR/verify-kafka-event-topic-partitions.sh"
  ok "Kafka domain topics present (proto-aligned list)"
  if [[ "${BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_SUITE:-0}" != "1" ]]; then
    say "[P5c] Kafka alignment suite (KAFKA_ALIGNMENT_TEST_MODE=1 — mutating/chaos tests)"
    KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite
    ok "kafka-alignment-suite complete"
  else
    echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_ALIGNMENT_SUITE=1 — skipping kafka-alignment-suite"
  fi
fi

# Single compound test (avoids nested if/fi drift that can surface as "syntax error near )" on some merges).
if { [[ "${BOOTSTRAP_SKIP_KAFKA_APPLY:-0}" == "1" ]] || [[ "${BOOTSTRAP_SKIP_KAFKA_TOPIC_PROVISION:-0}" == "1" ]]; } \
  && [[ "${BOOTSTRAP_GRAPH_COMPLETE_F_WITHOUT_P5C:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_GRAPH_COMPLETE_F_WITHOUT_P5C=1 — F.kafka_alignment will be marked after G.app_runtime (post P8 verify-app-runtime)."
fi

# --- P5d KAFKA READINESS GATE (brokers Ready + listener) before app images / deploy-dev ---
say "[P5d] Kafka readiness gate (pods + TCP :9093) before P6/P7"
if [[ "${BOOTSTRAP_SKIP_KAFKA_APPLY:-0}" == "1" ]]; then
  echo "  ℹ️  BOOTSTRAP_SKIP_KAFKA_APPLY=1 — skipping verify-kafka-ready.sh"
else
  chmod +x "$SCRIPT_DIR/verify-kafka-ready.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="${KAFKA_BROKER_REPLICAS:-3}" bash "$SCRIPT_DIR/verify-kafka-ready.sh"
  ok "Kafka readiness gate passed"
fi

# --- P6 IMAGES ---
say "[P6] IMAGE lifecycle (inspect || build+load)"
if [[ "${BOOTSTRAP_SKIP_DOCKER_CONTEXT_VERIFY:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/verify-build-context.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/verify-build-context.sh"
fi

# shellcheck source=scripts/lib/och-docker-image-source-hash.sh
source "$SCRIPT_DIR/lib/och-docker-image-source-hash.sh"

docker_build_tag() {
  local svc="$1"
  local tag="${2:-dev}"
  local df=""
  if [[ "$svc" == "webapp" ]]; then
    df="webapp/Dockerfile"
  else
    df="services/${svc}/Dockerfile"
  fi
  [[ -f "$REPO_ROOT/$df" ]] || { bad "no Dockerfile: $df"; exit 1; }

  _docker_build_tag_run() {
    if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
      docker build --platform "$DOCKER_DEFAULT_PLATFORM" -t "${svc}:${tag}" -f "$REPO_ROOT/$df" "$REPO_ROOT"
    else
      docker build -t "${svc}:${tag}" -f "$REPO_ROOT/$df" "$REPO_ROOT"
    fi
    if colima status 2>/dev/null | grep -qiE 'colima is running|running'; then
      docker save "${svc}:${tag}" | colima ssh -- docker load || { bad "colima load failed: ${svc}:${tag}"; exit 1; }
    fi
  }

  if [[ "$_force_rebuild" == "1" ]] || [[ "${BOOTSTRAP_SKIP_DOCKER_IMAGE_HASH_CACHE:-0}" == "1" ]]; then
    echo "  ▶ docker build ${svc}:${tag} …"
    _docker_build_tag_run
    if [[ "${BOOTSTRAP_SKIP_DOCKER_IMAGE_HASH_CACHE:-0}" != "1" ]]; then
      mkdir -p "$(och_docker_hash_cache_dir)"
      och_compute_service_source_hash "$svc" >"$(och_docker_hash_cache_dir)/${svc}.src.hash" || true
    fi
    return 0
  fi

  local cdir hnew hold
  cdir="$(och_docker_hash_cache_dir)"
  mkdir -p "$cdir"
  hnew="$(och_compute_service_source_hash "$svc")" || { bad "source hash failed for $svc"; exit 1; }
  hold=""
  [[ -f "$cdir/${svc}.src.hash" ]] && read -r hold <"$cdir/${svc}.src.hash" || true
  if [[ -n "$hold" ]] && [[ "$hold" == "$hnew" ]] && docker image inspect "${svc}:${tag}" &>/dev/null; then
    echo "  ⏭️  ${svc}:${tag} — source unchanged (hash cache) — skip docker build"
    och_ensure_colima_has_image "${svc}:${tag}" || { bad "colima load for ${svc}:${tag} failed"; exit 1; }
    return 0
  fi

  echo "  ▶ docker build ${svc}:${tag} …"
  _docker_build_tag_run
  echo "$hnew" >"$cdir/${svc}.src.hash"
}

IMG_LIST="${BOOTSTRAP_IMAGE_SERVICES:-$HOUSING_DOCKER_SERVICES_DEFAULT webapp}"
IMG_LIST="${IMG_LIST//,/ }"
_force_rebuild=0
if [[ "${BOOTSTRAP_FORCE_REBUILD_IMAGES:-0}" =~ ^(1|yes|true|YES|TRUE)$ ]]; then
  _force_rebuild=1
fi
if [[ "${BOOTSTRAP_FORCE_REBUILD_APP_IMAGES:-0}" =~ ^(1|yes|true|YES|TRUE)$ ]]; then
  _force_rebuild=1
fi
if [[ "$_force_rebuild" == "1" ]]; then
  say "[P6] BOOTSTRAP_FORCE_REBUILD_IMAGES=1 — rebuilding all housing/webapp :dev images (hash cache ignored)"
fi

if [[ "${VERIFY_APP_RUNTIME_PHASE:-}" == "cold" ]] && [[ "${COLD_BOOTSTRAP_REBUILD_API_GATEWAY:-0}" == "1" ]]; then
  rm -f "${REPO_ROOT}/.build-cache/api-gateway.src.hash"
  echo "  ℹ️  COLD_BOOTSTRAP_REBUILD_API_GATEWAY=1 — cleared api-gateway source hash cache (P6 will rebuild gateway)"
fi

for s in $IMG_LIST; do
  [[ -n "$s" ]] || continue
  docker_build_tag "$s" dev
  docker image inspect "${s}:dev" &>/dev/null || { bad "still missing: ${s}:dev"; exit 1; }
done

ok "images verified locally"

# --- P6b DAG C.images (Colima VM Docker must see ingress images before deploy-dev applies caddy-h3) ---
if [[ "${BOOTSTRAP_SKIP_INGRESS_TCPDUMP_IMAGES:-0}" == "1" ]]; then
  warn "BOOTSTRAP_SKIP_INGRESS_TCPDUMP_IMAGES=1 — skipping P6b C.images (ingress-nginx may hit ImagePullBackOff for caddy-with-tcpdump:dev)"
else
  say "[P6b] DAG C.images — ingress tcpdump images on host + load into Colima VM Docker"
  chmod +x "$SCRIPT_DIR/ensure-required-images.sh" "$SCRIPT_DIR/verify-required-images.sh" "$SCRIPT_DIR/ensure-caddy-envoy-tcpdump.sh" 2>/dev/null || true
  SKIP_PATCH=1 bash "$SCRIPT_DIR/ensure-caddy-envoy-tcpdump.sh" || {
    bad "ensure-caddy-envoy-tcpdump.sh (build only, SKIP_PATCH=1) failed — if Docker Hub 429: Dockerfiles use mirror.gcr.io bases; retry after pull, or docker login, or set OCH_*_TCPDUMP_BUILD_ARGS (see ensure-caddy-envoy-tcpdump.sh header)"
    exit 1
  }
  _t_ci="$(_och_bootstrap_ms_now)"
  _och_bootstrap_phase_guard --enter C.images || {
    bad "phase guard: cannot enter C.images (complete C.metrics first — cold bootstrap installs metrics-server after C.infra, or BOOTSTRAP_RESUME)"
    exit 1
  }
  if ! REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/ensure-required-images.sh"; then
    bad "C.images failed: ensure-required-images.sh (host → Colima VM docker load). See infra/required_images.json"
    _lf="$(_och_bootstrap_write_phase_error_log C.images ensure-required-images)"
    { colima status 2>&1 || true; docker images 2>&1 | head -40 || true; } >>"$_lf"
    _och_bootstrap_record_fail C.images "ensure-required-images failed" "$_lf"
    echo "  📄 error log: $_lf" >&2
    och_bootstrap_rollback_dispatch C.images || true
    exit 1
  fi
  _och_bootstrap_record_phase_timing_ms C.images "$(($(_och_bootstrap_ms_now) - _t_ci))"
  _och_bootstrap_phase_guard --complete C.images || true
  ok "C.images — required images in Colima VM Docker"
fi

# --- P7 MANIFESTS ---
say "[P7] MANIFESTS + rollouts (deploy-dev)"
export SKIP_SMOKE="${SKIP_SMOKE:-1}"
export SKIP_STRICT_ENVELOPE="${SKIP_STRICT_ENVELOPE:-1}"
bash "$SCRIPT_DIR/deploy-dev.sh"
ok "deploy-dev"

if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" != "1" ]]; then
  say "[P7a] Ollama gateway stack (k8s/ — gateway + worker; REDIS_URL from app-config; OLLAMA_GATEWAY_USE_EXTERNAL_REDIS=${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}; BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 skips)"
  chmod +x "$SCRIPT_DIR/apply-ollama-gateway-stack.sh" 2>/dev/null || true
  export OLLAMA_GATEWAY_USE_EXTERNAL_REDIS="${OLLAMA_GATEWAY_USE_EXTERNAL_REDIS:-1}"
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/apply-ollama-gateway-stack.sh"
  ok "P7a ollama-gateway stack"
else
  echo "  ℹ️  BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK=1 — skipping apply-ollama-gateway-stack.sh (k8s/ollama-gateway*.yaml + redis stack)"
fi

if [[ "${BOOTSTRAP_SKIP_DEPLOYMENT_INTEGRITY:-0}" != "1" ]]; then
  say "[P7b] deployment integrity + housing rollout gates"
  export AUTO_HEAL_DEPLOYMENTS="${BOOTSTRAP_DEPLOYMENT_INTEGRITY_AUTO_HEAL:-1}"
  bash "$SCRIPT_DIR/verify-deployment-integrity.sh"
  bash "$SCRIPT_DIR/wait-for-housing-rollouts.sh"
  ok "P7b deployment integrity + rollouts"
fi

# --- P8 EDGE + Kafka ---
say "[P8] ENDPOINT + edge + Kafka"
export HOUSING_NS="$NS"
bash "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh"

if [[ "${BOOTSTRAP_SKIP_OLLAMA_VERIFY:-0}" != "1" ]]; then
  say "[P8] Ollama (analytics LLM — deployment/ollama + model pull)"
  chmod +x "$SCRIPT_DIR/verify-ollama.sh" 2>/dev/null || true
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/verify-ollama.sh"
  ok "Ollama verified"
else
  echo "  ℹ️  BOOTSTRAP_SKIP_OLLAMA_VERIFY=1 — skipping verify-ollama.sh"
fi

if [[ "${BOOTSTRAP_SKIP_OLLAMA_GATEWAY_STACK:-0}" != "1" ]]; then
  say "[P8] Ollama gateway (deployment/ollama-gateway — /metrics smoke)"
  chmod +x "$SCRIPT_DIR/verify-ollama-gateway.sh" 2>/dev/null || true
  HOUSING_NS="$NS" bash "$SCRIPT_DIR/verify-ollama-gateway.sh"
  ok "Ollama gateway verified"
fi

if [[ "${BOOTSTRAP_SKIP_MAPS_VERIFY:-0}" != "1" ]]; then
  say "[P8] Google Maps API (Geocode smoke; BOOTSTRAP_SKIP_MAPS_VERIFY=1 skips)"
  MAPS_VERIFY_REQUIRE_KEY=1 bash "$SCRIPT_DIR/verify-google-maps.sh"
  ok "Google Maps API verified"
else
  echo "  ℹ️  BOOTSTRAP_SKIP_MAPS_VERIFY=1 — skipping verify-google-maps.sh"
fi

EDGE_HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
# Strict gateway: classify bootstrap edge checks as infra (see docs/TRAFFIC_CLASSIFICATION_POLICY.md).
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"
# Pod Ready ≠ app ready: gateway may return 503 until upstream warms (Kafka, DB pools, OTLP). Retry, do not fail on first 503.
_rz_max="${BOOTSTRAP_READYZ_MAX_ATTEMPTS:-45}"
_rz_sleep="${BOOTSTRAP_READYZ_SLEEP_SEC:-3}"
echo "  ▶ edge /api/readyz (max ${_rz_max} attempts × ${_rz_sleep}s, host=${EDGE_HOST})…"
_readyz_ok=0
for ((_rz_i = 1; _rz_i <= _rz_max; _rz_i++)); do
  _http="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 15 --max-time 90 \
    --cacert "$CA_PEM" \
    -H "x-traffic-class: infra" -H "x-suite: ${OCH_X_SUITE}" \
    "https://${EDGE_HOST}/api/readyz" 2>/dev/null || echo "000")"
  if [[ "$_http" == "200" ]]; then
    ok "/api/readyz (HTTP 200, attempt ${_rz_i})"
    _readyz_ok=1
    break
  fi
  if ((_rz_i < _rz_max)); then
    echo "    … HTTP ${_http} (attempt ${_rz_i}/${_rz_max}), sleep ${_rz_sleep}s"
    sleep "$_rz_sleep"
  fi
done
if [[ "$_readyz_ok" != "1" ]]; then
  bad "edge /api/readyz never returned 200 after ${_rz_max} attempts (last HTTP=${_http:-?}). Try: curl -v --cacert \"$CA_PEM\" -H \"x-traffic-class: infra\" -H \"x-suite: bash\" \"https://${EDGE_HOST}/api/readyz\""
  exit 1
fi

if [[ "${BOOTSTRAP_SKIP_EDGE_LATENCY_SLA:-0}" != "1" ]]; then
  say "[P8a] edge route latency SLA (probe-edge-route-latency.sh)"
  export HOST="$EDGE_HOST"
  export CA_CERT="$CA_PEM"
  bash "$SCRIPT_DIR/probe-edge-route-latency.sh"
  ok "edge latency SLA"
fi

make verify-kafka-bootstrap
ok "Kafka bootstrap verify"

say "[P8b] Application runtime readiness (scripts/verify-app-runtime.sh — DAG G.app_runtime)"
chmod +x "$SCRIPT_DIR/verify-app-runtime.sh" 2>/dev/null || true
if _och_node_is_complete G.app_runtime && [[ "${BOOTSTRAP_RESUME:-0}" == "1" ]] && [[ "${BOOTSTRAP_RESUME_FORCE_APP_RUNTIME_VERIFY:-0}" != "1" ]]; then
  echo "  ⏭️  BOOTSTRAP_RESUME=1 — G.app_runtime already complete; skipping verify-app-runtime.sh (set BOOTSTRAP_RESUME_FORCE_APP_RUNTIME_VERIFY=1 to re-run)"
else
  _t_g0="$(_och_bootstrap_ms_now)"
  if ! HOUSING_NS="$NS" NAMESPACE="$NS" bash "$SCRIPT_DIR/verify-app-runtime.sh"; then
    bad "verify-app-runtime.sh failed — critical app Deployments not rolled out or /healthz not OK (JSON on stdout ends with ok:false + errors[]; tune VERIFY_APP_RUNTIME_*)"
    _t1="$(_och_bootstrap_ms_now)"
    _och_bootstrap_record_phase_timing_ms G.app_runtime "$((_t1 - _t_g0))"
    _lf="$(_och_bootstrap_write_phase_error_log G.app_runtime verify-app-runtime)"
    {
      echo "namespace=${NS}"
      kubectl get pods -n "$NS" -o wide 2>&1 || true
      kubectl get deploy -n "$NS" -o wide 2>&1 | head -80 || true
    } >>"$_lf"
    _och_bootstrap_record_fail G.app_runtime "verify-app-runtime.sh failed" "$_lf"
    echo "  📄 error log: $_lf" >&2
    och_bootstrap_rollback_dispatch G.app_runtime || true
    exit 1
  fi
  _och_bootstrap_record_phase_timing_ms G.app_runtime "$(($(_och_bootstrap_ms_now) - _t_g0))"
fi

if ! _och_node_is_complete G.app_runtime; then
  _och_bootstrap_phase_guard --enter G.app_runtime || {
    bad "phase guard: cannot enter G.app_runtime (complete C.images first — run P6b ensure-required-images.sh / bootstrap)"
    exit 1
  }
fi
_och_bootstrap_phase_guard --complete G.app_runtime 2>/dev/null || true

if [[ "${BOOTSTRAP_SKIP_CRITICAL_PATH_REGRESSION:-0}" != "1" ]]; then
  say "[P8c] App-runtime DAG critical-path regression (detect-critical-path-regression.mjs)"
  if ! VERIFY_APP_RUNTIME_PROM_OUT="$REPO_ROOT/bench_logs/app_runtime_metrics.prom" \
    VERIFY_APP_RUNTIME_HISTORY="$REPO_ROOT/bench_logs/app_runtime_history.jsonl" \
    node "$SCRIPT_DIR/detect-critical-path-regression.mjs"; then
    bad "app-runtime DAG critical-path regression — see bench_logs/app_runtime_critical_path_regression_report.json (BOOTSTRAP_SKIP_CRITICAL_PATH_REGRESSION=1 or APP_RUNTIME_CRITICAL_PATH_REGRESSION_ALLOW=1 to allow)"
    exit 1
  fi
  ok "app-runtime critical-path regression check passed"
fi

if [[ "${BOOTSTRAP_SKIP_PHASE_GUARD:-0}" != "1" ]] && [[ -f "$REPO_ROOT/infra/bootstrap_invariants.graph.json" ]]; then
  if [[ "${BOOTSTRAP_SKIP_KAFKA_APPLY:-0}" != "1" ]] && [[ "${BOOTSTRAP_SKIP_KAFKA_TOPIC_PROVISION:-0}" != "1" ]]; then
    _och_bootstrap_phase_guard --enter F.kafka_alignment || { bad "phase guard: cannot enter F.kafka_alignment (complete G.app_runtime first)"; exit 1; }
    _och_bootstrap_phase_guard --complete F.kafka_alignment 2>/dev/null || true
  elif [[ "${BOOTSTRAP_GRAPH_COMPLETE_F_WITHOUT_P5C:-0}" == "1" ]]; then
    _och_bootstrap_phase_guard --enter F.kafka_alignment || { bad "phase guard: cannot enter F.kafka_alignment (complete G.app_runtime first)"; exit 1; }
    _och_bootstrap_phase_guard --complete F.kafka_alignment 2>/dev/null || true
    echo "  ℹ️  BOOTSTRAP_GRAPH_COMPLETE_F_WITHOUT_P5C=1 — marked F.kafka_alignment after G (topics/alignment asserted out-of-band)."
  fi
fi

# --- P9 HEALTH SCORE + DAG + ARTIFACT ---
say "[P9] bootstrap-health.json + dependency-dag-validation.json + bootstrap-artifact.json"
mkdir -p "$REPO_ROOT/bench_logs"
chmod +x "$SCRIPT_DIR/verify-kafka-tls-sans.sh" 2>/dev/null || true
python3 "$SCRIPT_DIR/cluster_health_dag.py" bootstrap --ns "$NS" --repo "$REPO_ROOT"

if [[ "${BOOTSTRAP_SKIP_REGRESSION_CHECK:-0}" != "1" ]]; then
  node "$SCRIPT_DIR/detect-bootstrap-regression.mjs" || {
    bad "bootstrap timing regression — see bench_logs/bootstrap_regression_report.json (omit FAIL_ON_REGRESSION=1 to allow)"
    exit 1
  }
  bash "$SCRIPT_DIR/export-bootstrap-regression-prom.sh" >/dev/null 2>&1 || true
fi

if [[ "${BOOTSTRAP_SKIP_TIMING_HISTORY:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/save-timing-history.sh" >/dev/null 2>&1 || true
  node "$SCRIPT_DIR/optimize-bootstrap-order.mjs" >/dev/null 2>&1 || true
fi

say "✅ Bootstrap v2 complete."
