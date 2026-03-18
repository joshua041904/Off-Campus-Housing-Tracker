#!/usr/bin/env bash
# Verify Caddy HTTP/3 (QUIC) from inside the cluster — bypasses NodePort and host UDP.
# Runs a one-off Pod that curls Caddy with --http3-only. Use when host HTTP/3 fails.
#
# Use: ./scripts/verify-caddy-http3-in-cluster.sh
#   CURL_IMAGE=alpine/curl-http3:latest  (default; in-cluster uses container curl, not host Homebrew)
#   TARGET_IP=192.168.106.240  (optional) — curl MetalLB IP from pod (tests real LB path in-cluster)
#   USE_HOST_CURL=1  (optional) — try host Homebrew curl first (LB IP); use when host UDP works
#   HOST=record.local  (required when TARGET_IP set for SNI)
#
# By default runs in-cluster (container image). Host-side checks (setup, baseline) use Homebrew curl; use USE_HOST_CURL=1 here to prefer host curl when you have an LB IP.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS_ING="${NS_ING:-ingress-nginx}"
NS_APP="${NS_APP:-record-platform}"
HOST="${HOST:-record.local}"
# Same default as scripts/lib/http3.sh so image is consistent
CURL_IMAGE="${CURL_IMAGE:-alpine/curl-http3:latest}"
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

# Optional: try host Homebrew curl first (USE_HOST_CURL=1 or when TARGET_IP set and host has --http3-only)
_curl_host=""
for _c in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl; do
  [[ -x "$_c" ]] && "$_c" --help all 2>/dev/null | grep -q -- "--http3-only" && _curl_host="$_c" && break
done
_lb_ip="${TARGET_IP:-}"
[[ -z "$_lb_ip" ]] && _lb_ip=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [[ -n "$_curl_host" ]] && [[ -n "$_lb_ip" ]] && [[ "${USE_HOST_CURL:-0}" == "1" ]]; then
  _ca="$REPO_ROOT/certs/dev-root.pem"
  [[ -s "$_ca" ]] || _ca=""
  if [[ -n "$_ca" ]]; then
    _code=$(NGTCP2_ENABLE_GSO=0 "$_curl_host" -sS -w '%{http_code}' -o /dev/null --max-time 15 --http3-only --cacert "$_ca" --resolve "record.local:443:$_lb_ip" "https://record.local/_caddy/healthz" 2>/dev/null) || _code=000
    if [[ "$_code" == "200" ]]; then
      ok "Caddy HTTP/3 OK via host Homebrew curl (record.local:443 -> $_lb_ip)"
      exit 0
    fi
  fi
  # Host curl failed or no CA; fall through to in-cluster
fi

# Ensure CA secret exists
if ! _kb -n "$NS_ING" get secret dev-root-ca -o name >/dev/null 2>&1; then
  if ! _kb -n "$NS_APP" get secret dev-root-ca -o name >/dev/null 2>&1; then
    fail "No dev-root-ca secret in $NS_ING or $NS_APP; cannot verify TLS"
  fi
  NS_CA="$NS_APP"
else
  NS_CA="$NS_ING"
fi

POD_NAME="verify-caddy-http3-$$"
_kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found --request-timeout=5s 2>/dev/null || true
sleep 1

# Caddy serves record.local (cert SAN). --resolve requires an IP; get ClusterIP or use TARGET_IP.
if [[ -n "${TARGET_IP:-}" ]]; then
  CURL_RESOLVE="record.local:443:${TARGET_IP}"
else
  _cluster_ip=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  [[ -z "$_cluster_ip" ]] && fail "Could not get caddy-h3 ClusterIP (is the service deployed?)"
  CURL_RESOLVE="record.local:443:${_cluster_ip}"
fi
CURL_URL="https://record.local/_caddy/healthz"
# NGTCP2_ENABLE_GSO=0 avoids QUIC issues.
cat <<PODEOF | _kb apply -f - 2>/dev/null || fail "Failed to create verify pod"
apiVersion: v1
kind: Pod
metadata:
  name: $POD_NAME
  namespace: $NS_ING
  labels:
    app: verify-caddy-http3
spec:
  restartPolicy: Never
  containers:
  - name: curl
    image: $CURL_IMAGE
    command:
    - /bin/sh
    - -c
    - |
      export NGTCP2_ENABLE_GSO=0
      code=\$(curl -sS -w '%{http_code}' -o /tmp/body --max-time 15 --connect-timeout 5 --http3-only --cacert /ca/dev-root.pem --resolve "$CURL_RESOLVE" "$CURL_URL" 2>/tmp/curl.err) || code=000
      code=\${code:-000}
      echo "HTTP_CODE:\$code"
      echo "--- CURL_STDERR ---"
      cat /tmp/curl.err 2>/dev/null || true
      exit 0
    volumeMounts:
    - name: ca
      mountPath: /ca
      readOnly: true
  volumes:
  - name: ca
    secret:
      secretName: dev-root-ca
      items:
      - key: dev-root.pem
        path: dev-root.pem
PODEOF

for i in $(seq 1 45); do
  phase=$(_kb -n "$NS_ING" get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
  [[ "$phase" == "Succeeded" ]] && break
  [[ "$phase" == "Failed" ]] && break
  sleep 1
done

if [[ "$phase" == "Failed" ]]; then
  _kb -n "$NS_ING" logs "$POD_NAME" -c curl 2>/dev/null | tail -25
  _kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found 2>/dev/null || true
  fail "Caddy HTTP/3 in-cluster verify failed (pod Failed). Check image $CURL_IMAGE and Caddy QUIC."
fi

http_code=$(_kb -n "$NS_ING" logs "$POD_NAME" -c curl 2>/dev/null | grep -o 'HTTP_CODE:[0-9]*' | tail -1 | cut -d: -f2 || echo "000")
_logs="$(_kb -n "$NS_ING" logs "$POD_NAME" -c curl 2>/dev/null || true)"
# Always show full pod output when non-200 so we see curl stderr and HTTP_CODE
if [[ "$http_code" != "200" ]]; then
  echo "" >&2
  echo "--- Full verify pod logs (curl container) ---" >&2
  if [[ -n "$_logs" ]]; then
    echo "$_logs" | sed 's/^/  /' >&2
  else
    echo "  (no logs; pod may have failed to start or image pull failed)" >&2
    _kb -n "$NS_ING" get pod "$POD_NAME" -o wide 2>/dev/null | sed 's/^/  /' >&2
    _kb -n "$NS_ING" describe pod "$POD_NAME" 2>/dev/null | tail -30 | sed 's/^/  /' >&2
  fi
  echo "---" >&2
  _kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found 2>/dev/null || true
  [[ -n "${TARGET_IP:-}" ]] && fail "Caddy HTTP/3 in-cluster via MetalLB IP ${TARGET_IP} returned HTTP $http_code (expected 200). Check Caddy QUIC and MetalLB." || fail "Caddy HTTP/3 in-cluster verify returned HTTP $http_code (expected 200). Image $CURL_IMAGE must have curl with --http3-only (e.g. alpine/curl-http3)."
fi
_kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found 2>/dev/null || true

[[ -n "${TARGET_IP:-}" ]] && ok "Caddy HTTP/3 OK in-cluster via MetalLB IP $TARGET_IP (QUIC to Caddy)" || ok "Caddy HTTP/3 OK in-cluster (QUIC to Caddy direct; no NodePort/host)"
