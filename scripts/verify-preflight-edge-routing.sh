#!/usr/bin/env bash
# Preflight / k6 edge routing gates: ingress path parity, DNS→LB alignment, strict-TLS curl to /api and /auth health.
# Prevents 0-byte k6 runs when /auth is missing from Ingress or DNS points at the wrong MetalLB service.
#
# Usage:
#   ./scripts/verify-preflight-edge-routing.sh [namespace] [edge_hostname]
# Env:
#   HOUSING_NS, OCH_EDGE_HOSTNAME (default off-campus-housing.test)
#   VERIFY_PREFLIGHT_EDGE_PHASES — comma list: ingress,dns,curl (default: all three)
#   PREFLIGHT_SKIP_EDGE_INGRESS_PARITY_GATE=1 — skip ingress
#   PREFLIGHT_SKIP_EDGE_DNS_LB_GATE=1 — skip dns
#   SKIP_K6_EDGE_CURL_GATE=1 — skip curl phase
#   OCH_EDGE_IP — if set to an IPv4, use for 6b2 LB alignment instead of resolving HOST (optional override)
#
# 6b2 resolves HOST with the system resolver (Python socket / getent / ping), not dig — dig often skips /etc/hosts,
# so it disagrees with curl, k6, and Playwright on macOS dev machines.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/edge-test-url.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/edge-test-url.sh"

NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
HOST="${2:-${OCH_EDGE_HOSTNAME:-off-campus-housing.test}}"
ING_NAME="${EDGE_INGRESS_NAME:-off-campus-housing-tracker}"
ING_NS="${EDGE_INGRESS_NAMESPACE:-$NS}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

RUN_INGRESS=0
RUN_DNS=0
RUN_CURL=0
IFS=',' read -r -a _phase_arr <<< "${VERIFY_PREFLIGHT_EDGE_PHASES:-ingress,dns,curl}"
for _x in "${_phase_arr[@]}"; do
  _t="${_x// /}"
  [[ -z "$_t" ]] && continue
  case "$_t" in
    ingress) RUN_INGRESS=1 ;;
    dns) RUN_DNS=1 ;;
    curl) RUN_CURL=1 ;;
  esac
done
[[ "${PREFLIGHT_SKIP_EDGE_INGRESS_PARITY_GATE:-0}" == "1" ]] && RUN_INGRESS=0
[[ "${PREFLIGHT_SKIP_EDGE_DNS_LB_GATE:-0}" == "1" ]] && RUN_DNS=0
[[ "${SKIP_K6_EDGE_CURL_GATE:-0}" == "1" ]] && RUN_CURL=0

_verify_ingress_python() {
  command -v python3 >/dev/null 2>&1 || {
    bad "python3 required for ingress JSON check"
    return 1
  }
  local _ing_json _jf
  _ing_json="$(kubectl get ingress "$ING_NAME" -n "$ING_NS" -o json 2>/dev/null)" || true
  if [[ -z "$_ing_json" ]]; then
    bad "kubectl get ingress $ING_NAME -n $ING_NS failed or returned empty (is the Ingress applied?)"
    return 1
  fi
  _jf="$(mktemp "${TMPDIR:-/tmp}/och-edge-ing.XXXXXX.json")"
  printf '%s\n' "$_ing_json" > "$_jf"
  export _EDGE_VERIFY_HOST="$HOST"
  export _EDGE_ING_JSON_FILE="$_jf"
  python3 <<'PY'
import json, os, sys

want_host = os.environ.get("_EDGE_VERIFY_HOST", "off-campus-housing.test")
path = os.environ["_EDGE_ING_JSON_FILE"]
with open(path, encoding="utf-8") as f:
    doc = json.load(f)
try:
    os.unlink(path)
except OSError:
    pass

rules = doc.get("spec", {}).get("rules") or []
EXPECTED = [
    ("/api", "Prefix", "api-gateway", 4020),
    ("/auth", "Prefix", "api-gateway", 4020),
    ("/", "Prefix", "nginx", 8080),
]

def check_paths(paths, label):
    if len(paths) < len(EXPECTED):
        return False, f"{label}: need at least {len(EXPECTED)} paths, got {len(paths)}"
    for i, exp in enumerate(EXPECTED):
        p = paths[i]
        path, ptype, svc, port = exp
        if p.get("path") != path or (p.get("pathType") or "") != ptype:
            return False, f"{label}: paths[{i}] want {path} {ptype}, got {p.get('path')!r} {p.get('pathType')!r}"
        bs = (p.get("backend") or {}).get("service") or {}
        num = (bs.get("port") or {}).get("number")
        if bs.get("name") != svc or num != port:
            return False, f"{label}: paths[{i}] backend want {svc}:{port}, got {bs.get('name')}:{num}"
    return True, ""

seen = 0
for rule in rules:
    h = rule.get("host")
    if h is not None and h != want_host:
        continue
    paths = (rule.get("http") or {}).get("paths") or []
    label = f"host={h!r}" if h is not None else "catch-all rule"
    ok, msg = check_paths(paths, label)
    if not ok:
        print(msg, file=sys.stderr)
        sys.exit(1)
    seen += 1

if seen == 0:
    print(f"no ingress rules for host {want_host!r} or catch-all", file=sys.stderr)
    sys.exit(1)
print("ingress path parity OK")
PY
  rm -f "$_jf" 2>/dev/null || true
}

_resolve_edge_ipv4() {
  local ip=""
  # 1) Python: same family of resolution as curl/Node on macOS/Linux (includes /etc/hosts).
  if command -v python3 >/dev/null 2>&1; then
    ip="$(EDGE_RESOLVE_HOST="$HOST" python3 -c 'import os, socket; print(socket.gethostbyname(os.environ["EDGE_RESOLVE_HOST"]))' 2>/dev/null || true)"
    if [[ -n "$ip" ]] && [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      ip=""
    fi
  fi
  # 2) Linux nss (files dns …)
  if [[ -z "$ip" ]] && command -v getent >/dev/null 2>&1; then
    ip="$(getent ahosts "$HOST" 2>/dev/null | awk '/STREAM/ {print $1; exit}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
  fi
  # 3) ping prints resolved IP in parens; ICMP may drop (MetalLB) but name resolution still prints.
  if [[ -z "$ip" ]] && command -v ping >/dev/null 2>&1; then
    ip="$(ping -c1 "$HOST" 2>/dev/null | head -n1 | sed -nE 's/.*\(([0-9]{1,3}(\.[0-9]{1,3}){3})\).*/\1/p')"
  fi
  # 4) dig last: queries DNS servers and often ignores /etc/hosts — misleading for local dev; kept as fallback only.
  if [[ -z "$ip" ]] && command -v dig >/dev/null 2>&1; then
    ip="$(dig +short "$HOST" A 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)"
  fi
  printf '%s' "$ip"
}

if [[ "$RUN_INGRESS$RUN_DNS$RUN_CURL" == "000" ]]; then
  ok "Edge routing verification skipped (all phases disabled)"
  exit 0
fi

if [[ "$RUN_INGRESS" -eq 1 ]]; then
  say "Edge 6b1 — Ingress path parity ($ING_NAME/$ING_NS, host $HOST)"
  _verify_ingress_python || exit 1
  ok "Ingress: /api + /auth → api-gateway:4020, / → nginx:8080 (ordered before catch-all /)"
fi

if [[ "$RUN_DNS" -eq 1 ]]; then
  say "Edge 6b2 — Hostname → LoadBalancer alignment ($HOST; system resolver, not dig-first)"
  if [[ -n "${OCH_EDGE_IP:-}" ]] && [[ "${OCH_EDGE_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    EDGE_IP="${OCH_EDGE_IP}"
    ok "Using OCH_EDGE_IP=$EDGE_IP for alignment check"
  else
    EDGE_IP="$(_resolve_edge_ipv4)"
  fi
  if [[ -z "$EDGE_IP" ]]; then
    bad "Could not resolve IPv4 for $HOST (tried Python socket, getent, ping, dig). Fix /etc/hosts or DNS (see OCH_EDGE_IP)."
    exit 1
  fi
  CADDY_IP="$(kubectl get svc caddy-h3 -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  CADDY_IP="${CADDY_IP//$'\r'/}"
  NGINX_IP="$(kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  NGINX_IP="${NGINX_IP//$'\r'/}"
  if [[ -z "$CADDY_IP" && -z "$NGINX_IP" ]]; then
    bad "No LoadBalancer IP on ingress-nginx/caddy-h3 or ingress-nginx-controller — cannot verify DNS/LB alignment (NodePort-only cluster?)."
    exit 1
  fi
  match=0
  [[ -n "$CADDY_IP" && "$EDGE_IP" == "$CADDY_IP" ]] && match=1
  [[ -n "$NGINX_IP" && "$EDGE_IP" == "$NGINX_IP" ]] && match=1
  if [[ "$match" -ne 1 ]]; then
    bad "DNS $HOST → $EDGE_IP does not match ingress-nginx LoadBalancers (caddy-h3=${CADDY_IP:-<none>}, ingress-nginx-controller=${NGINX_IP:-<none>}). k6 may hit wrong edge."
    edge_print_resolve_and_hosts_hint "$HOST" "${CADDY_IP:-$NGINX_IP}"
    exit 1
  fi
  ok "DNS $HOST → $EDGE_IP matches active ingress LB"
fi

if [[ "$RUN_CURL" -eq 1 ]]; then
  say "Edge k6 gate — strict TLS curl /api/healthz + /auth/healthz"
  CA="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
  edge_strict_curl_edge_health "https://${HOST}" "$CA" || exit 1
  ok "Edge health endpoints reachable (api + auth)"
fi

ok "Edge routing verification passed"
