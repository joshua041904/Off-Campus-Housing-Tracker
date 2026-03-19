#!/usr/bin/env bash
# One-command HTTP/3 diagnostic: Caddy built with h3, UDP 443 exposed, alt-svc, and curl --http3.
# Uses: namespace ingress-nginx, deployment caddy-h3 (not off-campus-housing / deploy/caddy).
#
# Usage: ./scripts/verify-http3-edge.sh
#   TARGET=https://off-campus-housing.local  (default)
#   CADDY_NS=ingress-nginx  DEPLOY=caddy-h3  (defaults; override if different)
#
# For this repo Caddy runs in ingress-nginx. If you have NS=record-platform in your
# environment, the script uses CADDY_NS (default ingress-nginx) so it still targets the right namespace.
#
# All 5 checks from the "Final Verification Checklist":
#   1. caddy version → h3 present
#   2. Service → 443/UDP exposed
#   3. alt-svc header → h3 advertised
#   4. curl --http3 → HTTP/3 200
#   5. tcpdump hint (optional)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Caddy namespace: default ingress-nginx for this repo (ignore stale NS=record-platform from env).
CADDY_NS="${CADDY_NS:-ingress-nginx}"
NS="$CADDY_NS"
DEPLOY="${DEPLOY:-caddy-h3}"
SVC="${SVC:-caddy-h3}"
TARGET="${TARGET:-https://off-campus-housing.local}"

# Use Homebrew curl when available (supports --http3). Fallback: PATH curl.
CURL_CMD=""
for p in /opt/homebrew/bin/curl /usr/local/bin/curl; do
  [[ -x "$p" ]] && { CURL_CMD="$p"; break; }
done
[[ -z "$CURL_CMD" ]] && CURL_CMD="curl"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "  ✅ $*"; }
warn(){ echo "  ⚠️  $*"; }
fail(){ echo "  ❌ $*"; }

PASS=0
FAIL=0

say "HTTP/3 edge verification (namespace=$NS, deploy=$SVC)"
echo "  Target: $TARGET"
echo "  curl: $CURL_CMD (script prefers Homebrew curl for --http3 test)"
echo "  (Resource names: deploy/$DEPLOY, svc/$SVC in namespace $NS — not off-campus-housing/deploy/caddy)"
echo ""

# --- Step 1: Caddy built with HTTP/3 ---
say "Step 1 — Caddy built with HTTP/3"
if kubectl get deploy "$DEPLOY" -n "$NS" --request-timeout=5s &>/dev/null; then
  VER=$(kubectl exec -n "$NS" "deploy/$DEPLOY" -- caddy version 2>/dev/null || true)
  # xcaddy-built Caddy 2.x includes HTTP/3 by default; version string may show h3 or only v2.x h1:...
  if echo "$VER" | grep -q 'h3'; then
    ok "Caddy has h3 in version: $VER"
    PASS=$((PASS + 1))
  elif echo "$VER" | grep -qE '^v2\.'; then
    ok "Caddy v2.x (xcaddy build includes HTTP/3): $VER"
    PASS=$((PASS + 1))
  else
    fail "Caddy version unclear for HTTP/3. Got: $VER"
    FAIL=$((FAIL + 1))
  fi
else
  warn "Deployment $DEPLOY not found in $NS. Run ./scripts/setup-tls-and-edge.sh"
  FAIL=$((FAIL + 1))
fi
# If deploy exists but pods are ImagePullBackOff, image may be missing in cluster (Colima: load from host).
if kubectl get deploy "$DEPLOY" -n "$NS" --request-timeout=5s &>/dev/null; then
  POD_STATUS=$(kubectl get pods -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[*].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)
  if echo "$POD_STATUS" | grep -q ImagePullBackOff; then
    echo "     💡 Caddy pods ImagePullBackOff? Build and load image into cluster (Colima):"
    echo "        docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile ."
    echo "        docker save caddy-with-tcpdump:dev | colima ssh -- docker load"
    echo "        kubectl -n $NS rollout restart deploy/$DEPLOY"
  fi
fi

# --- Step 2: UDP 443 on Service ---
say "Step 2 — UDP 443 exposed on Service"
if kubectl get svc "$SVC" -n "$NS" --request-timeout=5s &>/dev/null; then
  UDP_YAML=$(kubectl get svc "$SVC" -n "$NS" -o yaml 2>/dev/null || true)
  if echo "$UDP_YAML" | grep -q 'protocol: UDP' && echo "$UDP_YAML" | grep -q '443'; then
    ok "Service $SVC has TCP and UDP 443"
    kubectl get svc "$SVC" -n "$NS" -o wide 2>/dev/null | sed 's/^/     /'
    PASS=$((PASS + 1))
  else
    fail "Service $SVC missing UDP 443. Need ports: 443/TCP and 443/UDP (e.g. infra/k8s/loadbalancer.yaml)"
    FAIL=$((FAIL + 1))
  fi
else
  warn "Service $SVC not found in $NS"
  FAIL=$((FAIL + 1))
fi
# MetalLB is installed by setup-new-colima-cluster.sh. If EXTERNAL-IP is still pending, verify pool/L2.
LB_IP=$(kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
if kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
  if [[ -z "$LB_IP" ]]; then
    echo "     💡 LoadBalancer EXTERNAL-IP is <pending>. Pool may be wrong subnet for Colima VM. Fix:"
    echo "        ./scripts/apply-metallb-pool-colima.sh   (auto-detects VM subnet and re-applies pool + recreates caddy-h3 svc)"
    echo "     Or: ./scripts/verify-metallb-and-traffic-policy.sh   (verify pool/L2)"
  fi
fi

# --- Step 3 & 6: alt-svc header (curl -I over TLS) ---
# Try a reverse_proxy path first (root /) so Caddy's full pipeline runs and injects alt-svc.
# Fallback: /_caddy/healthz (Caddyfile now adds alt-svc there too; plain respond short-circuits otherwise).
say "Step 3 — alt-svc header (Caddy advertising h3)"
if command -v "$CURL_CMD" &>/dev/null; then
  CA_OPT=""
  if [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
    CA_OPT="--cacert $REPO_ROOT/certs/dev-root.pem"
  fi
  _alt_svc_ok=""
  for _url in "$TARGET" "${TARGET}/_caddy/healthz"; do
    HEADERS=$("$CURL_CMD" -sS -I -m 10 $CA_OPT "$_url" 2>/dev/null || true)
    if echo "$HEADERS" | grep -qi 'alt-svc:.*h3'; then
      _alt_svc_ok=1
      break
    fi
  done
  if [[ -n "$_alt_svc_ok" ]]; then
    ok "alt-svc advertises h3"
    echo "$HEADERS" | grep -i alt-svc | sed 's/^/     /'
    PASS=$((PASS + 1))
  else
    if [[ -z "$LB_IP" ]]; then
      warn "alt-svc not checked: no external IP (LoadBalancer pending). Run: ./scripts/apply-metallb-pool-colima.sh"
    else
      warn "alt-svc with h3 not found (TLS/cert or Caddy config). Headers:"
      echo "$HEADERS" | head -20 | sed 's/^/     /'
      FAIL=$((FAIL + 1))
    fi
  fi
else
  warn "curl not found; skip alt-svc check"
fi

# --- Step 4: curl --http3 (use Homebrew curl when available) ---
say "Step 4 — curl --http3 (QUIC handshake)"
if command -v "$CURL_CMD" &>/dev/null; then
  CA_OPT=""
  if [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
    CA_OPT="--cacert $REPO_ROOT/certs/dev-root.pem"
  fi
  OUT=$("$CURL_CMD" -sS -I -m 15 --http3 $CA_OPT "$TARGET" 2>&1 || true)
  if echo "$OUT" | grep -q 'HTTP/3 200'; then
    ok "HTTP/3 200 from $TARGET (using $CURL_CMD)"
    echo "$OUT" | head -5 | sed 's/^/     /'
    PASS=$((PASS + 1))
  elif echo "$OUT" | grep -qi "doesn't support\|libcurl version"; then
    warn "curl not built with HTTP/3. Step 4 skipped. Use Homebrew curl: brew install curl (then re-run; script prefers /opt/homebrew/bin/curl)"
  elif echo "$OUT" | grep -qi "HTTP/3 not supported\|QUIC\|connection refused"; then
    fail "HTTP/3 failed: $OUT"
    FAIL=$((FAIL + 1))
  else
    warn "curl --http3 result unclear (UDP blocked or Caddy down): $OUT"
    FAIL=$((FAIL + 1))
  fi
else
  warn "curl not found; skip HTTP/3 request check"
fi

# --- Step 5: tcpdump hint ---
say "Step 5 — Optional: QUIC traffic (tcpdump in Caddy pod)"
echo "  To confirm UDP 443 traffic from your laptop:"
echo "    kubectl exec -it -n $NS deploy/$DEPLOY -- tcpdump -i any udp port 443 -c 5"
echo "  Then load $TARGET in browser or: $CURL_CMD -I --http3 $TARGET"
echo "  (Use --cacert certs/dev-root.pem if using dev CA; Caddy image has tcpdump.)"
echo ""

# --- Summary ---
say "Summary"
echo "  Passed: $PASS  Failed: $FAIL"
if [[ $FAIL -eq 0 ]] && [[ $PASS -ge 3 ]]; then
  ok "HTTP/3 edge checks passed. You are running HTTP/3 correctly."
  exit 0
elif [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "  Common fixes:"
  echo "  - Wrong namespace: Use ingress-nginx for this repo. Unset NS or run: CADDY_NS=ingress-nginx $0"
  echo "  - ImagePullBackOff: ./scripts/load-caddy-image-colima.sh  (build + load caddy-with-tcpdump into Colima)"
  echo "  - EXTERNAL-IP <pending>: ./scripts/apply-metallb-pool-colima.sh (fix pool subnet + recreate caddy-h3 svc)"
  echo "  - UDP 443: Service must have port 443 protocol UDP (see infra/k8s/loadbalancer.yaml)"
  echo "  - TLS: Trust dev CA or use --cacert certs/dev-root.pem (scripts/lib/trust-dev-root-ca-macos.sh)"
  echo "  - Host: /etc/hosts or DNS for $(echo "$TARGET" | sed 's|https\?://||') pointing to Caddy LB IP (or node IP for NodePort)"
  exit 1
else
  exit 0
fi
