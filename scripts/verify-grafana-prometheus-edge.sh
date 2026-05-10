#!/usr/bin/env bash
# End-to-end checklist: Grafana / Prometheus behind Caddy subpaths.
# Run from repo root after ./scripts/rollout-caddy.sh and observability apply.
#
# Env:
#   EDGE_HOST              default off-campus-housing.test
#   NAMESPACE_INGRESS      default ingress-nginx  (caddy-h3 lives here, NOT off-campus-housing-tracker)
#   NS_OBS                 default observability
#   CURL_EXTRA             e.g. -k for self-signed TLS
#   VERIFY_RESTART_CADDY=1  also: kubectl rollout restart deploy/caddy-h3 (after you apply ConfigMap manually)
set -euo pipefail

EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
NAMESPACE_INGRESS="${NAMESPACE_INGRESS:-ingress-nginx}"
NS_OBS="${NS_OBS:-observability}"
CURL_EXTRA="${CURL_EXTRA:--k}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*"; }

say "1) Edge curl (expect HTML or 308→slash)"
for path in "/grafana/" "/prometheus/"; do
  code=$(curl -sS -o /tmp/och-verify-body.txt -w "%{http_code}" $CURL_EXTRA "https://${EDGE_HOST}${path}" || echo "000")
  if [[ "$code" == "200" ]]; then
    if head -c 64 /tmp/och-verify-body.txt | grep -qiE 'html|grafana|prometheus'; then
      ok "https://${EDGE_HOST}${path} → HTTP $code (looks like HTML)"
    else
      warn "https://${EDGE_HOST}${path} → HTTP $code (body may not be HTML; check /tmp/och-verify-body.txt)"
    fi
  elif [[ "$code" == "308" ]] || [[ "$code" == "301" ]] || [[ "$code" == "302" ]]; then
    warn "https://${EDGE_HOST}${path} → HTTP $code redirect"
  elif [[ "$code" == "502" ]]; then
    fail "https://${EDGE_HOST}${path} → 502 (upstream unreachable from Caddy)"
  elif [[ "$code" == "404" ]]; then
    fail "https://${EDGE_HOST}${path} → 404 (routing mismatch)"
  else
    warn "https://${EDGE_HOST}${path} → HTTP $code"
  fi
done

say "2) Trailing-slash redirects (/grafana and /prometheus without slash → Caddy 308, or upstream 301/302)"
for path in "/grafana" "/prometheus"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" $CURL_EXTRA "https://${EDGE_HOST}${path}" || echo "000")
  if [[ "$code" == "308" ]] || [[ "$code" == "301" ]] || [[ "$code" == "302" ]] || [[ "$code" == "303" ]]; then
    ok "https://${EDGE_HOST}${path} → HTTP $code (redirect to ${path}/)"
  else
    warn "https://${EDGE_HOST}${path} → HTTP $code (expected redirect to ${path}/)"
  fi
done

say "3) Grafana pod: GF_SERVER_* (ROOT_URL must end with /grafana/)"
if kubectl get deploy grafana -n "$NS_OBS" &>/dev/null; then
  kubectl exec -n "$NS_OBS" deploy/grafana -- env 2>/dev/null | grep -E '^GF_SERVER_' || warn "could not exec grafana (pod not ready?)"
else
  warn "no deploy/grafana in $NS_OBS"
fi

say "4) Prometheus deploy: route-prefix + external-url"
if kubectl get deploy prometheus -n "$NS_OBS" &>/dev/null; then
  if kubectl get deploy prometheus -n "$NS_OBS" -o yaml | grep -E "route-prefix|external-url" | head -5; then
    ok "found web flags in deploy yaml"
  else
    warn "missing route-prefix / external-url in yaml"
  fi
else
  warn "no deploy/prometheus in $NS_OBS"
fi

say "5) Caddy: deployment in ${NAMESPACE_INGRESS} (not off-campus-housing-tracker)"
if kubectl get deploy caddy-h3 -n "$NAMESPACE_INGRESS" &>/dev/null; then
  ok "deploy/caddy-h3 exists in $NAMESPACE_INGRESS"
  kubectl -n "$NAMESPACE_INGRESS" get pods -l app=caddy-h3 -o wide 2>/dev/null || true
else
  warn "deploy/caddy-h3 not in $NAMESPACE_INGRESS — set NAMESPACE_INGRESS if yours differs"
fi

say "6) Recent caddy-h3 logs (errors / listen)"
kubectl -n "$NAMESPACE_INGRESS" logs deploy/caddy-h3 --tail=40 2>/dev/null | grep -E -i 'error|listen|running|adapted' || true

if [[ "${VERIFY_RESTART_CADDY:-0}" == "1" ]]; then
  say "VERIFY_RESTART_CADDY=1 → rollout restart caddy-h3"
  kubectl -n "$NAMESPACE_INGRESS" rollout restart deployment/caddy-h3
  kubectl -n "$NAMESPACE_INGRESS" rollout status deployment/caddy-h3 --timeout=120s
fi

say "Done. If curl fails: ensure /etc/hosts maps ${EDGE_HOST} to MetalLB/LB IP; run ./scripts/rollout-caddy.sh after Caddyfile edits."
echo ""
echo "Optional direct Grafana (bypass Caddy):"
echo "  kubectl port-forward -n $NS_OBS svc/grafana 3000:3000"
echo "  open http://127.0.0.1:3000/grafana/"
