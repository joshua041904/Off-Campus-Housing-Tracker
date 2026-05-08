#!/usr/bin/env bash
# Strict MetalLB readiness before creating multiple LoadBalancer Services (e.g. kafka-*-external).
# Cold k3s + MetalLB: gate on stable signals (controller + speaker Available / rolled out), then prove one LB gets an IP.
# We do NOT scrape Endpoints/EndpointSlice for the admission webhook — shape varies by k8s version; the webhook runs
# in the controller pod, so deployment/controller Available is the stable signal.
#
# Usage: bash scripts/wait-for-metallb-lb-ready.sh
#
# Env:
#   METALLB_SYSTEM_NS — default metallb-system
#   METALLB_CONTROLLER_TIMEOUT — kubectl wait for controller Available (default 180s)
#   METALLB_SPEAKER_TIMEOUT — rollout status for speaker (default 180s)
#   METALLB_LB_PROBE_TIMEOUT — wait for probe Service EXTERNAL-IP (default 240s)
#   METALLB_LB_PROBE_NAMESPACE — namespace for probe (default default)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MS="${METALLB_SYSTEM_NS:-metallb-system}"
CTRL_TO="${METALLB_CONTROLLER_TIMEOUT:-180s}"
SP_TO="${METALLB_SPEAKER_TIMEOUT:-180s}"
LB_TO="${METALLB_LB_PROBE_TIMEOUT:-240}"
PROBE_NS="${METALLB_LB_PROBE_NAMESPACE:-default}"
PROBE_DEP="${METALLB_LB_PROBE_DEPLOYMENT:-metallb-lb-probe}"
PROBE_SVC="${METALLB_LB_PROBE_SERVICE:-metallb-lb-probe}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

command -v kubectl >/dev/null || { bad "kubectl required"; exit 1; }

if ! kubectl get ns "$MS" --request-timeout=10s &>/dev/null; then
  bad "namespace $MS not found (install MetalLB first)"
  exit 1
fi

say "[MetalLB gate] controller Deployment Available (webhook runs in controller)"
if ! kubectl -n "$MS" wait --for=condition=available deployment/controller --timeout="$CTRL_TO" 2>/dev/null; then
  bad "MetalLB controller not Available (ns=$MS). kubectl -n $MS get deploy,po,events"
  exit 1
fi
ok "controller Available"

say "[MetalLB gate] speaker DaemonSet"
if ! kubectl -n "$MS" get daemonset speaker --request-timeout=10s &>/dev/null; then
  bad "DaemonSet/speaker not found in $MS (unexpected MetalLB layout)"
  exit 1
fi
if ! kubectl -n "$MS" rollout status daemonset/speaker --timeout="$SP_TO" 2>/dev/null; then
  bad "MetalLB speaker DaemonSet not ready (ns=$MS)"
  exit 1
fi
ok "speaker rollout complete"

cleanup_probe() {
  kubectl delete svc "$PROBE_SVC" -n "$PROBE_NS" --ignore-not-found --wait=false 2>/dev/null || true
  kubectl delete deployment "$PROBE_DEP" -n "$PROBE_NS" --ignore-not-found --wait=false 2>/dev/null || true
}
trap cleanup_probe EXIT

say "[MetalLB gate] probe LoadBalancer (proves IP assignment works)"
cleanup_probe
sleep 2

kubectl --request-timeout=30s create deployment "$PROBE_DEP" --image=nginx:alpine -n "$PROBE_NS"
kubectl wait --for=condition=Available "deployment/$PROBE_DEP" -n "$PROBE_NS" --timeout=120s
kubectl --request-timeout=30s expose deployment "$PROBE_DEP" --name="$PROBE_SVC" --port=80 --target-port=80 --type=LoadBalancer -n "$PROBE_NS"

_ip=""
for ((t = 1; t <= LB_TO; t++)); do
  _ip="$(kubectl get svc "$PROBE_SVC" -n "$PROBE_NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$_ip" ]] && [[ "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    break
  fi
  _hn="$(kubectl get svc "$PROBE_SVC" -n "$PROBE_NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$_hn" ]]; then
    bad "probe LB got hostname ${_hn} (need IPv4 for kafka-refresh-tls-from-lb) — check MetalLB pool / cloud"
    exit 1
  fi
  if ((t % 15 == 1)); then
    echo "  waiting for probe EXTERNAL-IP… ($t/${LB_TO}s)"
  fi
  sleep 1
done

if [[ -z "$_ip" ]] || ! [[ "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  bad "Timed out waiting for EXTERNAL-IP on probe Service ${PROBE_NS}/${PROBE_SVC}"
  kubectl get svc "$PROBE_SVC" -n "$PROBE_NS" -o wide 2>/dev/null || true
  kubectl -n "$MS" get pods -o wide 2>/dev/null || true
  exit 1
fi

ok "MetalLB assigned probe IP: ${_ip}"

# Brief settle before caller creates multiple LBs (ARP / speaker convergence).
_stabilize="${METALLB_POST_PROBE_SLEEP:-20}"
if [[ "$_stabilize" -gt 0 ]]; then
  echo "  sleeping ${_stabilize}s for L2 announcer to stabilize…"
  sleep "$_stabilize"
fi

trap - EXIT
cleanup_probe
sleep 1

ok "MetalLB LB readiness gate complete"
