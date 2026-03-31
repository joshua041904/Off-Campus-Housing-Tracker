#!/usr/bin/env bash
# Edge checklist when k6 shows 0 B received / timeouts: DNS → TLS → ingress vs Caddy → paths.
# Caddy (ingress-nginx ns) routes /api/* and /auth/* to api-gateway:4020 (see infra/k8s/caddy-h3-configmap.yaml).
# ingress-nginx (housing ns) must also route /auth → gateway (see infra/k8s/overlays/dev/ingress.yaml).
#
# Usage (repo root):
#   ./scripts/diagnose-k6-edge-connectivity.sh
#   HOUSING_NS=off-campus-housing-tracker CA=certs/dev-root.pem ./scripts/diagnose-k6-edge-connectivity.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
HOST="${EDGE_HOST:-off-campus-housing.test}"
CA="${CA:-$REPO_ROOT/certs/dev-root.pem}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

say "1) DNS: $HOST"
if command -v dig >/dev/null 2>&1; then
  dig "$HOST" +short || true
fi
LB_IP="$(edge_hint_lb_ip_for_och || true)"
if [[ -n "$LB_IP" ]]; then
  ok "LoadBalancer hint: $LB_IP (Caddy / ingress-nginx — use same IP in /etc/hosts for $HOST if DNS empty)"
else
  warn "No LoadBalancer IP from kubectl (cluster API reachable?)"
fi

if [[ ! -f "$CA" ]]; then
  warn "CA missing: $CA"
else
  say "2) TLS (openssl s_client, SNI $HOST)"
  if [[ -n "${LB_IP:-}" ]]; then
    echo | openssl s_client -connect "${LB_IP}:443" -servername "$HOST" -CAfile "$CA" </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null || warn "openssl verify path failed — check IP/port"
  else
    echo | openssl s_client -connect "${HOST}:443" -servername "$HOST" -CAfile "$CA" </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || warn "Could not open TLS session (DNS/firewall?)"
  fi

  say "3) HTTP (curl — prefer --resolve if DNS broken)"
  if [[ -n "${LB_IP:-}" ]]; then
    if curl -sfS --max-time 15 --cacert "$CA" --resolve "${HOST}:443:${LB_IP}" "https://${HOST}/api/healthz" >/dev/null; then
      ok "GET https://${HOST}/api/healthz (via --resolve $LB_IP)"
    else
      warn "curl /api/healthz failed — edge or gateway not reachable"
    fi
    if curl -sfS --max-time 15 --cacert "$CA" --resolve "${HOST}:443:${LB_IP}" "https://${HOST}/auth/healthz" >/dev/null; then
      ok "GET https://${HOST}/auth/healthz (via --resolve $LB_IP)"
    else
      warn "curl /auth/healthz failed — if using nginx ingress, apply dev overlay ingress ( /auth → api-gateway )"
    fi
  else
    if curl -sfS --max-time 15 --cacert "$CA" "https://${HOST}/api/healthz" >/dev/null; then
      ok "GET https://${HOST}/api/healthz"
    else
      warn "curl /api/healthz failed"
    fi
  fi
fi

if command -v kubectl >/dev/null 2>&1; then
  say "4) Cluster: ingress + Caddy LoadBalancers (external traffic should match one of these)"
  kubectl get svc -n "$HOUSING_NS" -l 'app.kubernetes.io/name=ingress-nginx' 2>/dev/null || true
  kubectl get svc -n ingress-nginx 2>/dev/null | head -20 || true
  kubectl get ingress -n "$HOUSING_NS" 2>/dev/null || true
fi

say "5) Bypass edge (gateway only — confirms app vs ingress)"
echo "  kubectl -n $HOUSING_NS port-forward svc/api-gateway 4020:4020"
echo "  curl -sS http://127.0.0.1:4020/healthz   # gateway liveness (no TLS)"
echo "  curl -sS http://127.0.0.1:4020/api/healthz"

say "k6 env (from host)"
echo "  export SSL_CERT_FILE=$CA"
echo "  export BASE_URL=https://${HOST}"
echo "  # If DNS missing: add \"$LB_IP $HOST\" to /etc/hosts or: OCH_AUTO_EDGE_HOSTS=1 with sudo"
echo "  ./scripts/run-housing-k6-edge-smoke.sh"
