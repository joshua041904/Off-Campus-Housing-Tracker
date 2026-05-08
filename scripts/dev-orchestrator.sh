#!/usr/bin/env bash
# Core OCH dev bring-up phases (Colima → infra → deps → certs → images → cluster/Kafka/edge).
# **Preferred entry:** `scripts/dev-up.sh` ( **`make dev`** ) — sets OCH edge hostname, runs this script, then `dev-health-check.sh` + `dev-state.json`.
# Preflight pipelines stay separate — do not invoke this from preflight.
#
# Usage (repo root):
#   ./scripts/dev-orchestrator.sh
#   DRY_RUN=1 ./scripts/dev-orchestrator.sh
#   SKIP_BUILD=1 SKIP_CERTS=1 ./scripts/dev-orchestrator.sh   # dev-fast
#   DEV_VERIFY_ONLY=1 ./scripts/dev-orchestrator.sh          # dev-verify (existing cluster)
#
# Env:
#   DRY_RUN=1                   — print phases, do not execute side effects
#   SKIP_BUILD=1                — skip make images
#   SKIP_CERTS=1                — skip zero-trust CA preflight + dev-root EKU/SAN validation
#   SKIP_DEPS=1                 — skip make deps
#   SKIP_INFRA=1                — skip bring-up-external-infra
#   DEV_VERIFY_ONLY=1           — only kube + edge + TLS + Kafka checks (no cluster bring-up)
#   REQUIRE_COLIMA=0            — k3d/other: skip Colima start + docker context enforcement
#   RESTORE_BACKUP_DIR          — optional; dev-up.sh defaults to latest when backups exist (dump-only DBs)
#   DEV_VERIFY_KAFKA_ALIGNMENT=1 — dev-verify: run kafka-alignment-suite instead of kafka-health
#   DEV_VERIFY_INCLUDE_OBSERVABILITY=1 — dev-verify: apply + wait Jaeger/OTel/Prometheus/Grafana before Kafka check
#   DEV_ALLOW_EKS_DEV=1         — allow make dev against EKS-looking cluster (default: fail fast)
#   TEST_BREAK_DOCKER=1         — fail fast in Phase 0 with unreachable DOCKER_HOST (make test-dev-orchestrator-docker-break)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# OCH edge SNI / hostname (not record.test).
export OCH_EDGE_HOSTNAME="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"

DRY_RUN="${DRY_RUN:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_CERTS="${SKIP_CERTS:-0}"
SKIP_DEPS="${SKIP_DEPS:-0}"
SKIP_INFRA="${SKIP_INFRA:-0}"
DEV_VERIFY_ONLY="${DEV_VERIFY_ONLY:-0}"
REQUIRE_COLIMA="${REQUIRE_COLIMA:-}"
DEV_VERIFY_KAFKA_ALIGNMENT="${DEV_VERIFY_KAFKA_ALIGNMENT:-0}"
DEV_VERIFY_INCLUDE_OBSERVABILITY="${DEV_VERIFY_INCLUDE_OBSERVABILITY:-0}"

make() {
  command make -C "$REPO_ROOT" "$@"
}

is_dry() {
  [[ "${DRY_RUN}" == "1" ]]
}

_phase() {
  printf '\n\033[1m=== %s ===\033[0m\n' "$1"
}

ensure_node_20() {
  command -v node >/dev/null 2>&1 || {
    echo "❌ node not on PATH (Node >= 20 required per package.json engines)." >&2
    exit 1
  }
  local major
  major="$(node -p "parseInt(process.versions.node.split('.')[0],10)" 2>/dev/null || echo 0)"
  if [[ "$major" -lt 20 ]]; then
    echo "❌ Node $major found; require Node >= 20 (use fnm/nvm: fnm use / nvm use 20)." >&2
    exit 1
  fi
  echo "  ✅ Node $(node -v)"
}

ensure_pnpm() {
  if command -v fnm >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    eval "$(fnm env)" 2>/dev/null || true
  fi
  command -v pnpm >/dev/null 2>&1 || {
    echo "❌ pnpm not on PATH (install pnpm or fnm + corepack enable)." >&2
    exit 1
  }
  echo "  ✅ pnpm $(pnpm -v 2>/dev/null || echo ok)"
}

ensure_colima_running() {
  if [[ "${REQUIRE_COLIMA:-0}" != "1" ]]; then
    echo "  ℹ️  REQUIRE_COLIMA!=1 — skipping Colima auto-start"
    return 0
  fi
  if is_dry; then
    echo "  [DRY_RUN] colima status || colima start --with-kubernetes …"
    return 0
  fi
  command -v colima >/dev/null 2>&1 || {
    echo "❌ Colima required (REQUIRE_COLIMA=1) but colima not in PATH." >&2
    exit 1
  }
  if colima status 2>/dev/null | grep -qi 'colima is running' \
    || colima list 2>/dev/null | grep -Eq '^default[[:space:]]+Running\b'; then
    echo "  ✅ Colima already running"
    return 0
  fi
  echo "  ▶ Starting Colima with Kubernetes…"
  CPU="${CPU:-12}"
  MEMORY="${MEMORY:-16}"
  DISK="${DISK:-256}"
  COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
  colima start --cpu "$CPU" --memory "$MEMORY" --disk "$DISK" --network-address --with-kubernetes --kubernetes-version "$COLIMA_K3S_VERSION"
  echo "  ✅ Colima started"
}

ensure_docker_context() {
  if [[ "${REQUIRE_COLIMA:-0}" != "1" ]]; then
    return 0
  fi
  if is_dry; then
    echo "  [DRY_RUN] source ensure-colima-docker-context.sh + och_ensure_colima_docker_context"
    return 0
  fi
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
  export OCH_KUBE_CONTEXT="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || echo colima)}"
  if ! och_ensure_colima_docker_context; then
    echo "❌ Docker context / Colima socket alignment failed." >&2
    exit 1
  fi
  echo "  ✅ Docker reachable (context=$(docker context show 2>/dev/null || echo '?'))"
}

ensure_kubeconfig() {
  command -v kubectl >/dev/null 2>&1 || {
    echo "❌ kubectl not on PATH" >&2
    exit 1
  }
  # After cold start, KUBECONFIG is often unset and ~/.kube/config can still point at a dead
  # 127.0.0.1:<ephemeral-port> from an old SSH tunnel. Always (re)establish the canonical 6443 tunnel first.
  if [[ "${REQUIRE_COLIMA:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/colima-forward-6443.sh" ]]; then
    chmod +x "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
    echo "  ▶ Colima k3s API: scripts/colima-forward-6443.sh (pin 127.0.0.1:6443 + tunnel)…"
    if ! bash "$SCRIPT_DIR/colima-forward-6443.sh"; then
      echo "  ℹ️  Recycling API tunnel (--restart)…"
      bash "$SCRIPT_DIR/colima-forward-6443.sh" --restart || {
        echo "❌ colima-forward-6443.sh failed (Colima running? ~/.colima/_lima/colima/ssh.config present?)" >&2
        exit 1
      }
    fi
  fi
  if [[ "${REQUIRE_COLIMA:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
    # shellcheck source=scripts/lib/colima-kubeconfig.sh
    source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
    if ! kubectl get nodes --request-timeout=12s >/dev/null 2>&1; then
      echo "  ℹ️  kubectl API still unreachable — trying Colima kubeconfig files (native port)…"
      och_export_colima_kubeconfig_prefer_reachable || true
    elif [[ -z "${KUBECONFIG:-}" ]]; then
      och_export_colima_kubeconfig_prefer_reachable || {
        local _k="${HOME}/.colima/default/kubernetes/kubeconfig"
        [[ -s "$_k" ]] || _k="${HOME}/.colima/default/kubeconfig"
        [[ -s "$_k" ]] && export KUBECONFIG="$_k"
      }
    fi
    echo "  ℹ️  KUBECONFIG=${KUBECONFIG:-<default>}"
  fi
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ -z "$ctx" ]]; then
    echo "❌ No kubectl current-context. Set KUBECONFIG to Colima kubeconfig or merge configs." >&2
    exit 1
  fi
  if [[ "${REQUIRE_COLIMA:-0}" == "1" ]] && [[ "$ctx" != *colima* ]]; then
    echo "❌ REQUIRE_COLIMA=1 but current context is '$ctx' (expected *colima*)." >&2
    echo "   Fix: export KUBECONFIG=\$HOME/.colima/default/kubernetes/kubeconfig && kubectl config use-context colima" >&2
    exit 1
  fi
  if [[ "${REQUIRE_COLIMA:-0}" == "1" ]] && ! kubectl get nodes --request-timeout=12s >/dev/null 2>&1; then
    echo "❌ kubectl cannot reach the cluster (get nodes failed). Colima running? Stale kubeconfig: try" >&2
    echo "   export KUBECONFIG=\"\$HOME/.colima/default/kubernetes/kubeconfig\" && kubectl config use-context colima" >&2
    exit 1
  fi
  echo "  ✅ kubectl context: $ctx"
}

_validate_dev_root_eku_san_expiry() {
  local pem="$REPO_ROOT/certs/dev-root.pem"
  [[ -f "$pem" ]] || {
    echo "❌ Missing $pem — run without SKIP_CERTS=1 or run ./scripts/dev-onboard-zero-trust-preflight.sh" >&2
    exit 1
  }
  openssl x509 -in "$pem" -noout -checkend 86400 >/dev/null 2>&1 || {
    echo "❌ dev-root.pem expires within 24h or is invalid — regenerate (pnpm run reissue / zero-trust preflight)." >&2
    exit 1
  }
  local txt
  txt="$(openssl x509 -in "$pem" -noout -text 2>/dev/null || true)"
  if ! grep -q "CA:TRUE" <<<"$txt"; then
    echo "❌ dev-root.pem missing basicConstraints CA:TRUE" >&2
    exit 1
  fi
  echo "  ✅ dev-root.pem validity OK (openssl checkend + CA basicConstraints)"
}

# mkcert / LibreSSL often omit a readable "Extended Key Usage" block in `openssl x509 -text` even when the cert
# is valid for TLS server + client. `openssl x509 -purpose` is the portable contract check.
_x509_purpose_ssl_server_yes() {
  openssl x509 -in "$1" -noout -purpose 2>/dev/null | grep -q 'SSL server : Yes'
}
_x509_purpose_ssl_client_yes() {
  openssl x509 -in "$1" -noout -purpose 2>/dev/null | grep -q 'SSL client : Yes'
}

_validate_server_leaf_if_present() {
  local f
  # Prefer PEM bundle; fall back to CRT-only material from reissue / mkcert flows.
  local _och=()
  if [[ -f "$REPO_ROOT/certs/off-campus-housing.test.pem" ]]; then
    _och+=("$REPO_ROOT/certs/off-campus-housing.test.pem")
  elif [[ -f "$REPO_ROOT/certs/off-campus-housing.test.crt" ]]; then
    _och+=("$REPO_ROOT/certs/off-campus-housing.test.crt")
  fi
  for f in "${_och[@]}" "$REPO_ROOT/certs/record.test.pem" "$REPO_ROOT/certs/record.test.crt"; do
    [[ -f "$f" ]] || continue
    if ! _x509_purpose_ssl_server_yes "$f"; then
      echo "❌ $f: not usable as a TLS server cert (openssl x509 -purpose lacks \"SSL server : Yes\"). Regenerate: make tls-first-time / reissue." >&2
      exit 1
    fi
    if ! _x509_purpose_ssl_client_yes "$f"; then
      echo "❌ $f: not usable as a TLS client cert for mTLS (openssl x509 -purpose lacks \"SSL client : Yes\"). Regenerate leaf with serverAuth+clientAuth EKU." >&2
      exit 1
    fi
    openssl x509 -in "$f" -noout -checkend 86400 >/dev/null 2>&1 || {
      echo "❌ $f expires within 24h or invalid" >&2
      exit 1
    }
    echo "  ✅ $(basename "$f"): TLS server+client purposes OK (openssl -purpose) + not expiring in 24h"
  done
}

# When kafka-ssl-from-dev-root.sh has run before, broker PEM + client.crt must still satisfy mTLS EKU contract.
_validate_kafka_ssl_material_if_present() {
  local bp="$REPO_ROOT/certs/kafka-ssl/kafka-broker.pem"
  local cc="$REPO_ROOT/certs/kafka-ssl/client.crt"
  [[ -f "$bp" ]] || return 0
  if ! _x509_purpose_ssl_server_yes "$bp" || ! _x509_purpose_ssl_client_yes "$bp"; then
    echo "❌ $bp: Kafka broker cert must allow both SSL server and SSL client (inter-broker mTLS). Re-run: ./scripts/kafka-ssl-from-dev-root.sh" >&2
    exit 1
  fi
  echo "  ✅ certs/kafka-ssl/kafka-broker.pem: TLS server+client purposes OK"
  if [[ -f "$cc" ]]; then
    if ! _x509_purpose_ssl_client_yes "$cc"; then
      echo "❌ $cc: Kafka client cert must allow SSL client" >&2
      exit 1
    fi
    echo "  ✅ certs/kafka-ssl/client.crt: SSL client purpose OK"
  fi
}

fail_if_eks_wrong_path() {
  if is_dry; then
    echo "  [DRY_RUN] skip EKS provider probe"
    return 0
  fi
  if ! kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
    return 0
  fi
  local prov
  prov="$(kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' 2>/dev/null || true)"
  if [[ "$prov" == *aws* ]] && [[ "${DEV_ALLOW_EKS_DEV:-0}" != "1" ]]; then
    echo "❌ Cluster looks like EKS (providerID contains aws). Local \`make dev\` targets Colima/k3s." >&2
    echo "   Use: make dev-onboard (EKS path) or DEV_VERIFY_ONLY=1 with the intended kubeconfig." >&2
    exit 1
  fi
}

phase_verify_only() {
  _phase "DEV VERIFY ONLY — existing cluster (no bring-up / no teardown)"
  ensure_kubeconfig
  if [[ "${REQUIRE_COLIMA:-0}" == "1" ]]; then
    ensure_docker_context
  fi
  export EDGE_HOSTS_STRICT="${EDGE_HOSTS_STRICT:-1}"
  export HOSTS_AUTO="${HOSTS_AUTO:-1}"
  if is_dry; then
    echo "[DRY_RUN] make ensure-edge-hosts"
    echo "[DRY_RUN] edge-readiness-gate.sh"
    echo "[DRY_RUN] make verify-preflight-edge-routing"
    if [[ "${DEV_VERIFY_INCLUDE_OBSERVABILITY}" == "1" ]]; then
      echo "[DRY_RUN] ensure-observability-stack-ready.sh (DEV_VERIFY_INCLUDE_OBSERVABILITY=1)"
    fi
    echo "[DRY_RUN] make kafka-health (set DEV_VERIFY_KAFKA_ALIGNMENT=1 for kafka-alignment-suite)"
    echo ""
    echo "✅ dev-verify dry-run complete."
    exit 0
  fi
  make ensure-edge-hosts
  NS_ING="${NS_ING:-ingress-nginx}" HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/edge-readiness-gate.sh"
  make verify-preflight-edge-routing
  if [[ "${DEV_VERIFY_INCLUDE_OBSERVABILITY}" == "1" ]]; then
    chmod +x "$SCRIPT_DIR/ensure-observability-stack-ready.sh"
    bash "$SCRIPT_DIR/ensure-observability-stack-ready.sh"
  fi
  if [[ "${DEV_VERIFY_KAFKA_ALIGNMENT}" == "1" ]]; then
    KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite
  else
    make kafka-health
  fi
  echo ""
  echo "✅ dev-verify complete (cluster unchanged)."
  exit 0
}

# --- Default REQUIRE_COLIMA: Darwin → 1, else 0 unless already set ---
if [[ -z "${REQUIRE_COLIMA}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    REQUIRE_COLIMA=1
  else
    REQUIRE_COLIMA=0
  fi
fi
export REQUIRE_COLIMA

if [[ "$DEV_VERIFY_ONLY" == "1" ]]; then
  _phase "Phase 0 — Environment (verify-only)"
  ensure_node_20
  ensure_pnpm
  phase_verify_only
fi

_phase "Phase 0 — Environment sanity"
ensure_node_20
ensure_pnpm
# Fast failure-injection for CI / make test-dev-orchestrator-docker-break (before Colima start).
if [[ "${TEST_BREAK_DOCKER:-0}" == "1" ]] && ! is_dry; then
  export DOCKER_HOST=tcp://127.0.0.1:1
  unset DOCKER_CONTEXT 2>/dev/null || true
  if docker info >/dev/null 2>&1; then
    echo "❌ TEST_BREAK_DOCKER=1 but docker info succeeded (unexpected)" >&2
    exit 1
  fi
  echo "❌ Docker unreachable (TEST_BREAK_DOCKER=1 — expected deterministic failure)" >&2
  exit 1
fi
if [[ "${REQUIRE_COLIMA}" == "1" ]]; then
  ensure_colima_running
  ensure_kubeconfig
  ensure_docker_context
else
  ensure_kubeconfig
fi

fail_if_eks_wrong_path

# If Phase 1 restores from all-8 dumps, Phase 5 (make up-fast → infra-cluster) must not re-run infra/db SQL
# or a second restore — use SKIP_BOOTSTRAP + SKIP_AUTO_RESTORE for that subprocess tree.
OCH_PHASE1_DUMP_RESTORE=0
[[ -n "${RESTORE_BACKUP_DIR:-}" && "${SKIP_INFRA:-0}" != "1" ]] && OCH_PHASE1_DUMP_RESTORE=1
export OCH_PHASE1_DUMP_RESTORE

if [[ "$SKIP_INFRA" != "1" ]]; then
  _phase "Phase 1 — External infra (Compose: Postgres, Redis, MinIO)"
  if is_dry; then
    echo "[DRY_RUN] bring-up-external-infra.sh (RESTORE_BACKUP_DIR=${RESTORE_BACKUP_DIR:-})"
  else
    chmod +x "$SCRIPT_DIR/bring-up-external-infra.sh"
    export PGPASSWORD="${PGPASSWORD:-postgres}"
    export SKIP_AUTO_RESTORE="${SKIP_AUTO_RESTORE:-0}"
    export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-}"
    bash "$SCRIPT_DIR/bring-up-external-infra.sh"
  fi
else
  _phase "Phase 1 — skipped (SKIP_INFRA=1)"
fi

# Same order as dev-onboard-local.sh: deps before zero-trust (reissue needs workspace install).
if [[ "$SKIP_DEPS" != "1" ]]; then
  _phase "Phase 2 — Workspace deps (make deps)"
  if is_dry; then
    echo "[DRY_RUN] make deps"
  else
    make deps
  fi
else
  _phase "Phase 2 — skipped (SKIP_DEPS=1)"
fi

if [[ "$SKIP_CERTS" != "1" ]]; then
  _phase "Phase 3 — Certificates (dev-root + optional leaf EKU/SAN)"
  if is_dry; then
    echo "[DRY_RUN] dev-onboard-zero-trust-preflight.sh + openssl validation"
  else
    chmod +x "$SCRIPT_DIR/dev-onboard-zero-trust-preflight.sh"
    bash "$SCRIPT_DIR/dev-onboard-zero-trust-preflight.sh"
    _validate_dev_root_eku_san_expiry
    _validate_server_leaf_if_present
    _validate_kafka_ssl_material_if_present
  fi
else
  _phase "Phase 3 — skipped (SKIP_CERTS=1)"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  _phase "Phase 4 — Build + load housing :dev images (make images)"
  if is_dry; then
    echo "[DRY_RUN] make images"
  else
    make images
  fi
else
  _phase "Phase 4 — skipped (SKIP_BUILD=1)"
fi

_phase "Phase 5–10 — Cluster bootstrap + Kafka + edge (dev-onboard-from-up-fast)"
export DEV_ONBOARD_STRICT="${DEV_ONBOARD_STRICT:-1}"
if [[ "${OCH_PHASE1_DUMP_RESTORE:-0}" == "1" ]]; then
  export SKIP_BOOTSTRAP=1
  export SKIP_AUTO_RESTORE=1
  echo "  ℹ️  Dump restore was requested in Phase 1 → SKIP_BOOTSTRAP=1 SKIP_AUTO_RESTORE=1 for up-fast (no infra/db SQL; no second restore)."
fi
if is_dry; then
  echo "[DRY_RUN] bash scripts/dev-onboard-from-up-fast.sh (OCH_PHASE1_DUMP_RESTORE=${OCH_PHASE1_DUMP_RESTORE:-0} SKIP_BOOTSTRAP=${SKIP_BOOTSTRAP:-})"
  echo ""
  echo "✅ make dev — dry run complete."
  exit 0
fi

chmod +x "$SCRIPT_DIR/dev-onboard-from-up-fast.sh"
bash "$SCRIPT_DIR/dev-onboard-from-up-fast.sh"

echo ""
echo "✅ make dev — environment ready (orchestrator finished)."
