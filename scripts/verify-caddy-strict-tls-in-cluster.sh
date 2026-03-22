#!/usr/bin/env bash
# Verify Caddy strict TLS from inside the cluster (no port-forward or host reachability).
# Runs a one-off Pod that curls https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz
# with dev-root-ca; exit 0 if HTTP 200 and no curl 60. Use when host cannot reach Caddy (e.g. k3d MetalLB).
#
# Breakdown:
#   1. Reads dev-root-ca from ingress-nginx (or off-campus-housing-tracker) secret.
#   2. Creates a temporary Pod with curl image and CA mounted; runs curl with --cacert and Host: off-campus-housing.test.
#   3. Waits for pod completion; exit 0 if curl succeeded (strict TLS OK), else exit 1.
# Use: ./scripts/verify-caddy-strict-tls-in-cluster.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS_ING="${NS_ING:-ingress-nginx}"
NS_APP="${NS_APP:-off-campus-housing-tracker}"
HOST="${HOST:-off-campus-housing.test}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:latest}"
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

# Ensure CA secret exists
if ! _kb -n "$NS_ING" get secret dev-root-ca -o name >/dev/null 2>&1; then
  if ! _kb -n "$NS_APP" get secret dev-root-ca -o name >/dev/null 2>&1; then
    fail "No dev-root-ca secret in $NS_ING or $NS_APP; cannot verify strict TLS"
  fi
  NS_CA="$NS_APP"
else
  NS_CA="$NS_ING"
fi

POD_NAME="verify-caddy-strict-tls-$$"
# Single pod: curl with CA, write HTTP code to /tmp/code. No port-forward needed (in-cluster DNS).
_kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found --request-timeout=5s 2>/dev/null || true
sleep 1
cat <<PODEOF | _kb apply -f - 2>/dev/null || fail "Failed to create verify pod"
apiVersion: v1
kind: Pod
metadata:
  name: $POD_NAME
  namespace: $NS_ING
  labels:
    app: verify-caddy-strict-tls
spec:
  restartPolicy: Never
  containers:
  - name: curl
    image: $CURL_IMAGE
    command:
    - /bin/sh
    - -c
    - |
      code=\$(curl -sS -w '%{http_code}' -o /tmp/body --max-time 15 --connect-timeout 5 --http2 --cacert /ca/dev-root.pem -H "Host: $HOST" "https://caddy-h3.$NS_ING.svc.cluster.local:443/_caddy/healthz")
      echo "HTTP_CODE:\$code"
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

for i in $(seq 1 30); do
  phase=$(_kb -n "$NS_ING" get pod "$POD_NAME" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
  [[ "$phase" == "Succeeded" ]] && break
  [[ "$phase" == "Failed" ]] && break
  sleep 1
done

if [[ "$phase" == "Failed" ]]; then
  _kb -n "$NS_ING" logs "$POD_NAME" -c curl 2>/dev/null | tail -20
  _kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found 2>/dev/null || true
  fail "Caddy in-cluster verify failed (pod Failed). Check CA/Caddy match and Caddy in ingress-nginx."
fi

# Read HTTP code from pod logs (exec does not work on terminated containers)
http_code=$(_kb -n "$NS_ING" logs "$POD_NAME" -c curl 2>/dev/null | grep -o 'HTTP_CODE:[0-9]*' | tail -1 | cut -d: -f2 || echo "000")
_kb delete pod -n "$NS_ING" "$POD_NAME" --ignore-not-found 2>/dev/null || true

if [[ "$http_code" != "200" ]]; then
  fail "Caddy in-cluster verify returned HTTP $http_code (expected 200)"
fi

ok "Caddy strict TLS OK in-cluster (HTTP 200, no port-forward)"
