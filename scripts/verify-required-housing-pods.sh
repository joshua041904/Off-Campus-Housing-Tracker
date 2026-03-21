#!/usr/bin/env bash
# Fail if expected housing Deployments are missing or not Available in the app namespace,
# plus envoy-test and Caddy in ingress-nginx. Use after kustomize apply + image load.
#
# Usage: ./scripts/verify-required-housing-pods.sh
#   HOUSING_NS=off-campus-housing-tracker   (default — USE THIS, not NS=)
#   STRICT=1                       exit 1 on any failure (default 1)
#   PREFLIGHT_APP_DEPLOYS="..."    space-separated list (default = full housing set + media)
#
# NOTE: We intentionally do NOT read generic NS= from the environment. Many shells export
# NS=record-platform (or other repos); that would make this script check the wrong namespace.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
NS="$HOUSING_NS"
STRICT="${STRICT:-1}"

DEFAULT_DEPLOYS="auth-service api-gateway listings-service booking-service messaging-service trust-service analytics-service media-service notification-service"
DEPLOYS="${PREFLIGHT_APP_DEPLOYS:-$DEFAULT_DEPLOYS}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

_k() { kubectl --request-timeout=15s "$@"; }

say "Verifying required Deployments (HOUSING_NS=$HOUSING_NS → namespace $NS, envoy-test, ingress-nginx)…"

bad=0
for d in $DEPLOYS; do
  if ! _k get deploy -n "$NS" "$d" &>/dev/null; then
    warn "Missing Deployment $NS/$d — apply: kustomize build infra/k8s/overlays/dev | kubectl apply -f -"
    bad=1
    continue
  fi
  ready=$(_k get deploy -n "$NS" "$d" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_k get deploy -n "$NS" "$d" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  [[ -z "$desired" || "$desired" == "0" ]] && desired=1
  [[ "$ready" == "$desired" ]] && ok "$d ($ready/$desired ready)" || { warn "$d ready=$ready desired=$desired (kubectl describe deploy -n $NS $d)"; bad=1; }
done

if ! _k get deploy -n envoy-test envoy-test &>/dev/null; then
  warn "Missing envoy-test/envoy-test — edge gRPC routing will not work."
  bad=1
else
  ok "envoy-test deployment present"
fi

if ! _k get deploy -n ingress-nginx caddy-h3 &>/dev/null; then
  warn "Missing ingress-nginx/caddy-h3"
  bad=1
else
  ok "caddy-h3 deployment present"
fi

if [[ "$bad" -ne 0 ]]; then
  say "Fix: ./scripts/build-housing-images-k3s.sh && kustomize build infra/k8s/overlays/dev | kubectl apply -f - && kubectl rollout status deploy/listings-service -n $HOUSING_NS --timeout=300s"
  say "Tip: if you meant a different cluster namespace, run: HOUSING_NS=your-ns $0"
  [[ "$STRICT" == "1" ]] && fail "Required deployments not ready."
  exit 0
fi
ok "All required deployments present (ready counts may still be 0 if images missing — describe pods for ImagePullBackOff)."
exit 0
