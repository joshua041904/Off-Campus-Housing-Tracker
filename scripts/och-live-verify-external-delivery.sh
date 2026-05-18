#!/usr/bin/env bash
# Live smoke checks for external delivery (edge + cluster). Does not send mail/SMS.
# Real inbox/handset checks require operator credentials and a signed-in browser session.
#
# Usage:
#   ./scripts/och-live-verify-external-delivery.sh
#   BASE_URL=https://off-campus-housing.test HOUSING_NS=off-campus-housing-tracker ./scripts/och-live-verify-external-delivery.sh
set -euo pipefail
BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

echo "== TLS / edge: GET $BASE_URL/ =="
code_home=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$BASE_URL/" || echo "000")
echo "   HTTP $code_home"

echo "== Capabilities (unauthenticated; expect 401 without JWT) =="
code_cap=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$BASE_URL/api/messaging/messages/external-contact/capabilities" || echo "000")
echo "   HTTP $code_cap"

if command -v kubectl >/dev/null 2>&1 && kubectl get ns "$NS" &>/dev/null; then
  echo "== ConfigMap app-config (email/sms mode keys) =="
  kubectl get configmap app-config -n "$NS" -o jsonpath='{.data.EMAIL_DELIVERY_MODE}{"\n"}{.data.SMS_DELIVERY_MODE}{"\n"}' 2>/dev/null | sed 's/^/   /' || echo "   (configmap read failed)"
  echo "== messaging-service pod env (first pod) =="
  pod=$(kubectl get pods -n "$NS" -l app=messaging-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -n "${pod:-}" ]]; then
    kubectl exec -n "$NS" "$pod" -c app -- printenv EMAIL_DELIVERY_MODE SMS_DELIVERY_MODE 2>/dev/null | paste - - | sed 's/^/   /' || true
  else
    echo "   (no messaging pod found)"
  fi
else
  echo "== kubectl / namespace $NS unavailable — skip cluster checks =="
fi

echo ""
echo "Manual final acceptance (not automated):"
echo "  1) Set app-secrets SMTP_* to a real relay + app-config EMAIL_DELIVERY_MODE=self_hosted_smtp|provider"
echo "  2) kubectl rollout restart deploy/messaging-service -n $NS"
echo "  3) Sign in at $BASE_URL → Messages → Email → send to a real inbox; confirm receipt + history status=sent + no DM thread"
