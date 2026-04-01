#!/usr/bin/env bash
# In-cluster HTTP smoke: api-gateway /healthz (port 4020). Requires kubectl + reachable api-gateway Service.
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/ci/smoke-api-gateway.sh
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
HOST="api-gateway.${NS}.svc.cluster.local"
PORT="${API_GATEWAY_PORT:-4020}"
HEALTH_PATH="${API_GATEWAY_HEALTH_PATH:-/healthz}"
ATTEMPTS="${SMOKE_ATTEMPTS:-12}"
SLEEP="${SMOKE_SLEEP_SEC:-5}"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

if ! kubectl get deployment api-gateway -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  echo "⚠️  No deployment/api-gateway in $NS — skipping gateway smoke"
  exit 0
fi

echo "▶ Smoke: http://${HOST}:${PORT}${HEALTH_PATH}"

for i in $(seq 1 "$ATTEMPTS"); do
  echo "  attempt $i/$ATTEMPTS"
  pod="smoke-curl-$(date +%s)-${RANDOM}"
  kubectl --request-timeout=90s run "$pod" \
    --image=curlimages/curl:8.5.0 \
    -n "$NS" \
    --restart=Never \
    -- \
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://${HOST}:${PORT}${HEALTH_PATH}" \
    >/dev/null 2>&1 || true

  phase=""
  for _t in $(seq 1 45); do
    phase="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' --request-timeout=10s 2>/dev/null || true)"
    if [[ "$phase" == "Succeeded" ]] || [[ "$phase" == "Failed" ]]; then
      break
    fi
    sleep 2
  done

  code="$(kubectl logs "pod/$pod" -n "$NS" --request-timeout=30s 2>/dev/null | tr -d '\r\n' || echo 000)"
  kubectl delete pod "$pod" -n "$NS" --ignore-not-found --request-timeout=30s --wait=false >/dev/null 2>&1 || true

  if [[ "$phase" == "Succeeded" ]] && [[ "$code" == "200" ]]; then
    echo "✅ Gateway smoke OK (HTTP $code)"
    exit 0
  fi
  echo "  phase=${phase:-unknown} HTTP=${code:-000} — retry in ${SLEEP}s"
  sleep "$SLEEP"
done

echo "❌ Gateway smoke failed after $ATTEMPTS attempts" >&2
exit 1
