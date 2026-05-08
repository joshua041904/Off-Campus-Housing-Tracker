#!/usr/bin/env bash
# Install metrics-server (C.metrics), patch for k3s/Colima when needed, wait for rollout, probe kubectl top.
# Idempotent: safe to re-run. Writes bootstrap_metrics_server_ready + node headroom lines to bench_logs/bootstrap.prom
#
# Env:
#   REPO_ROOT — repo root (default: parent of scripts/)
#   BOOTSTRAP_PROM_FILE — append metrics here (default: $REPO_ROOT/bench_logs/bootstrap.prom)
#   METRICS_SERVER_FORCE_K3S_PATCH=1 — always apply insecure-tls args (even on non-k3s)
#   BOOTSTRAP_SKIP_METRICS_SERVER=1 — caller should not invoke; exits 0 if set
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export REPO_ROOT
PROM_FILE="${BOOTSTRAP_PROM_FILE:-$REPO_ROOT/bench_logs/bootstrap.prom}"
KUSTOMIZE_DIR="$REPO_ROOT/infra/k8s/base/metrics-server"
ROLLOUT_TIMEOUT="${METRICS_SERVER_ROLLOUT_TIMEOUT:-120s}"

if [[ "${BOOTSTRAP_SKIP_METRICS_SERVER:-0}" == "1" ]]; then
  echo "bootstrap-metrics-server: BOOTSTRAP_SKIP_METRICS_SERVER=1 — skipping"
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "bootstrap-metrics-server: kubectl not found" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/bench_logs"
echo "# metrics-server bootstrap at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$PROM_FILE"

echo "Applying metrics-server (kustomize)…"
kubectl apply -k "$KUSTOMIZE_DIR"

apply_k3s_patch=false
_kv="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}' 2>/dev/null || true)"
if echo "$_kv" | grep -qi k3s; then
  apply_k3s_patch=true
fi
if [[ "${METRICS_SERVER_FORCE_K3S_PATCH:-0}" == "1" ]]; then
  apply_k3s_patch=true
fi

if [[ "$apply_k3s_patch" == "true" ]]; then
  echo "Patching metrics-server for k3s/Colima kubelet (--kubelet-insecure-tls, InternalIP)…"
  _args="$(kubectl get deployment metrics-server -n kube-system -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null || true)"
  if echo "$_args" | grep -q 'kubelet-insecure-tls'; then
    echo "  (patch args already present — skipping json patch)"
  else
    kubectl patch deployment metrics-server -n kube-system --type='json' \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"},{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-preferred-address-types=InternalIP"}]' \
      || {
        echo "bootstrap-metrics-server: kubectl patch failed" >&2
        exit 1
      }
  fi
fi

echo "Waiting for metrics-server rollout (timeout ${ROLLOUT_TIMEOUT})…"
kubectl rollout status deployment/metrics-server -n kube-system --timeout="$ROLLOUT_TIMEOUT"

chmod +x "$SCRIPT_DIR/export-node-headroom-prom.sh" 2>/dev/null || true
for _i in 1 2 3 4 5 6 7 8 9 10; do
  if kubectl top nodes --no-headers >/dev/null 2>&1; then
    echo "bootstrap_metrics_server_ready 1" >>"$PROM_FILE"
    bash "$SCRIPT_DIR/export-node-headroom-prom.sh" >>"$PROM_FILE" || true
    kubectl top nodes
    exit 0
  fi
  echo "  waiting for metrics API (attempt ${_i}/10)…"
  sleep 2
done

echo "bootstrap_metrics_server_ready 0" >>"$PROM_FILE"
echo "bootstrap-metrics-server: metrics-server rolled out but kubectl top nodes still failing" >&2
exit 1
