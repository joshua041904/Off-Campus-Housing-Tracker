#!/usr/bin/env bash
# Patch core housing deployments to always_on trace sampling before Jaeger Step7 / trace-flow checks.
# Opt-out: PREFLIGHT_KUBECTL_OTEL_ALWAYS_ON=0
set -euo pipefail
NS="${HOUSING_NS:-off-campus-housing-tracker}"
if [[ "${PREFLIGHT_KUBECTL_OTEL_ALWAYS_ON:-1}" != "1" ]]; then
  echo "kubectl-set-otel-always-on-step7: skipped (PREFLIGHT_KUBECTL_OTEL_ALWAYS_ON=0)"
  exit 0
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl-set-otel-always-on-step7: kubectl not on PATH — skip"
  exit 0
fi
for d in api-gateway booking-service analytics-service listings-service; do
  if kubectl get deployment "$d" -n "$NS" &>/dev/null; then
    echo "kubectl-set-otel-always-on-step7: set OTEL_TRACES_SAMPLER=always_on on deployment/$d"
    kubectl set env "deployment/$d" OTEL_TRACES_SAMPLER=always_on OTEL_TRACES_SAMPLER_ARG=1 -n "$NS" || true
    kubectl rollout status "deployment/$d" -n "$NS" --timeout=180s || true
  else
    echo "kubectl-set-otel-always-on-step7: no deployment/$d in $NS — skip"
  fi
done
echo "kubectl-set-otel-always-on-step7: done"
