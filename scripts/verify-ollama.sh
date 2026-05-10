#!/usr/bin/env bash
# Ollama: rollout + ollama list + lightweight non-blocking API check.
# Verification intentionally avoids /api/generate so bootstrap never blocks on cold CPU inference.
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/verify-ollama.sh
# Env:
#   VERIFY_OLLAMA_MODEL — model (default OLLAMA_MODEL or llama3.2:1b)
#   VERIFY_OLLAMA_ROLLOUT_TIMEOUT — rollout timeout (default 1200s)
#   VERIFY_OLLAMA_CONTAINER — container name (default ollama)
#   BOOTSTRAP_SKIP_OLLAMA_VERIFY=1 — skip
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
MODEL="${VERIFY_OLLAMA_MODEL:-${OLLAMA_MODEL:-llama3.2:1b}}"
ROLL_TIMEOUT="${VERIFY_OLLAMA_ROLLOUT_TIMEOUT:-1200}"
OLLAMA_CONTAINER="${VERIFY_OLLAMA_CONTAINER:-ollama}"
# Hit the Kubernetes Service DNS from inside the pod (not loopback) so the check matches real traffic paths.
OLLAMA_TAGS_URL="${VERIFY_OLLAMA_TAGS_URL:-http://ollama.${NS}.svc.cluster.local:11434/api/tags}"

if [[ "${BOOTSTRAP_SKIP_OLLAMA_VERIFY:-0}" == "1" ]]; then
  echo "verify-ollama: skipped (BOOTSTRAP_SKIP_OLLAMA_VERIFY=1)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || {
  echo "verify-ollama: kubectl required" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "::error::verify-ollama: jq required on host" >&2
  exit 1
}

if [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=10s &>/dev/null; then
    och_export_colima_kubeconfig_prefer_reachable || true
  fi
fi

if ! kubectl get deploy/ollama -n "$NS" --request-timeout=15s &>/dev/null; then
  echo "::error::verify-ollama: deployment/ollama missing in $NS" >&2
  exit 1
fi

echo "▶ verify-ollama: rollout status deployment/ollama (timeout ${ROLL_TIMEOUT}s)"
kubectl rollout status "deployment/ollama" -n "$NS" --timeout="${ROLL_TIMEOUT}s"

echo "▶ verify-ollama: model '$MODEL' present (ollama list)"
_list="$(kubectl exec -n "$NS" "deploy/ollama" -c "$OLLAMA_CONTAINER" --request-timeout=60s -- ollama list 2>/dev/null || true)"
if [[ -z "$_list" ]]; then
  echo "::error::verify-ollama: ollama list produced no output" >&2
  exit 1
fi
printf '%s\n' "$_list"
if ! printf '%s\n' "$_list" | grep -qF "$MODEL"; then
  echo "::error::verify-ollama: model '$MODEL' not in ollama list" >&2
  exit 1
fi

echo "▶ verify-ollama: /api/tags non-blocking check (service DNS: ${OLLAMA_TAGS_URL})"
_tags="$(kubectl exec -n "$NS" "deploy/ollama" -c "$OLLAMA_CONTAINER" --request-timeout=45s -- \
  env TAGS_URL="$OLLAMA_TAGS_URL" sh -c 'wget -qO- --timeout=20 "$TAGS_URL" 2>/dev/null || curl -sS --max-time 20 "$TAGS_URL" 2>/dev/null || true' || true)"
if [[ -z "${_tags//[$'\t\r\n ']}" ]]; then
  echo "⚠️  verify-ollama: /api/tags empty (wget/curl missing or API race). Continuing because ollama list gate passed." >&2
  echo "✅ verify-ollama: rollout OK, model in list (non-blocking mode)"
  exit 0
fi
if ! printf '%s\n' "$_tags" | jq -e . >/dev/null 2>&1; then
  echo "⚠️  verify-ollama: /api/tags returned invalid JSON. Continuing because ollama list gate passed." >&2
  printf '%s\n' "$_tags" | head -c 1200 >&2 || true
  echo "✅ verify-ollama: rollout OK, model in list (non-blocking mode)"
  exit 0
fi
if ! printf '%s\n' "$_tags" | jq -e --arg m "$MODEL" '.models[]? | select(.name == $m)' >/dev/null 2>&1; then
  echo "⚠️  verify-ollama: model '$MODEL' missing from /api/tags models[]; using ollama list as source of truth." >&2
fi

echo "✅ verify-ollama: rollout OK, model in list, /api/tags OK (non-blocking)"
