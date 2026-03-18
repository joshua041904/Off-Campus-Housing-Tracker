#!/usr/bin/env bash
# Run k6 (HTTP/2 + HTTP/3) entirely in-cluster: Pod → Caddy ClusterIP. No host/VM in path (transport isolation).
# Use to confirm HTTP/3 scales when the limiter isn't Mac/Colima. See docs/ROTATION_RUNBOOK_CA_LEAF.md.
# Requires: k6-custom image (with xk6-http3) in cluster — see scripts/build-k6-image.sh and run-k6-chaos.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
NS="k6-load"
CA_CONFIGMAP="k6-ca-cert"
DURATION="${DURATION:-30s}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✔ $*"; }

CA="$REPO_ROOT/certs/dev-root.pem"
if [[ ! -f "$CA" ]] || ! grep -q 'BEGIN CERTIFICATE' "$CA" 2>/dev/null; then
  echo "ERROR: CA not found or invalid: $CA" >&2
  echo "  Run rotation or preflight once so certs/dev-root.pem exists." >&2
  exit 1
fi

# Ensure namespace and CA ConfigMap exist (so Job can mount CA for strict TLS).
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"
kubectl -n "$NS" create configmap "$CA_CONFIGMAP" --from-file=ca.crt="$CA" --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null
ok "CA ConfigMap $CA_CONFIGMAP ready"

# Do not export TARGET_IP or K6_LB_IP — Job will use ClusterIP (caddy-h3.ingress-nginx.svc.cluster.local).
unset TARGET_IP K6_LB_IP
export DURATION CA_CONFIGMAP

say "Starting in-cluster k6 (ClusterIP only; no MetalLB in path)…"
JOB=$("$SCRIPT_DIR/run-k6-chaos.sh" start 2>/dev/null | grep -oE 'k6-chaos-[0-9]+' | head -1)
if [[ -z "$JOB" ]]; then
  echo "ERROR: run-k6-chaos.sh start did not return job name (check k6-custom image and cluster)" >&2
  exit 1
fi
ok "Job $JOB started"

say "Waiting for job (timeout 120s)…"
"$SCRIPT_DIR/run-k6-chaos.sh" wait "$JOB" 120s
OUT=$("$SCRIPT_DIR/run-k6-chaos.sh" collect "$JOB" 2>/dev/null || echo "")
if [[ -n "$OUT" ]] && [[ -f "$OUT" ]]; then
  ok "Results: $OUT"
else
  kubectl -n "$NS" logs "job/$JOB" 2>/dev/null | tail -80
fi
