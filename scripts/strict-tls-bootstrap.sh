# file: scripts/strict-tls-bootstrap.sh  (re-run to ensure secrets exist in BOTH namespaces)
#!/usr/bin/env bash
set -euo pipefail
# Run from repo root. dev-root.pem, record.local.crt, record.local.key must be in ./certs/
# For Envoy→backend mTLS we also need a dedicated Envoy client cert (CN=envoy). Generate with:
#   KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh   # persists certs/dev-root.key
#   ./scripts/generate-envoy-client-cert.sh                         # creates certs/envoy-client.crt|.key
# After this script: Envoy presents the Envoy client cert to gRPC backends (not the edge leaf).
# If you see "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure",
# ensure envoy-client-tls exists and Envoy deploy uses it (envoy.crt/envoy.key).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
# Caddy terminates TLS at the edge; record-local-tls is the leaf cert. Secret type is immutable — delete then create if replacing.
for ns in ingress-nginx record-platform; do
  kubectl -n "$ns" delete secret record-local-tls --ignore-not-found
  kubectl -n "$ns" create secret tls record-local-tls \
    --cert=certs/record.local.crt --key=certs/record.local.key
done
kubectl -n ingress-nginx create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl -n record-platform create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
# Backends (auth-service, etc.) use secret "service-tls" with tls.crt, tls.key, ca.crt for TLS server + client cert verification (real mTLS).
kubectl -n record-platform delete secret service-tls --ignore-not-found
kubectl -n record-platform create secret generic service-tls \
  --from-file=tls.crt=certs/record.local.crt \
  --from-file=tls.key=certs/record.local.key \
  --from-file=ca.crt=certs/dev-root.pem
kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl -n envoy-test create secret generic dev-root-ca \
  --from-file=dev-root.pem=certs/dev-root.pem \
  -o yaml --dry-run=client | kubectl apply -f -
# Envoy uses a dedicated client cert (CN=envoy), not the edge leaf, so backends see a proper client identity.
if [[ -f certs/envoy-client.crt ]] && [[ -f certs/envoy-client.key ]]; then
  kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found
  kubectl -n envoy-test create secret generic envoy-client-tls \
    --from-file=envoy.crt=certs/envoy-client.crt \
    --from-file=envoy.key=certs/envoy-client.key
  echo "Envoy client secret envoy-client-tls created (CN=envoy)."
else
  echo "⚠️  certs/envoy-client.crt or certs/envoy-client.key missing. Run: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh then ./scripts/generate-envoy-client-cert.sh"
  if kubectl -n envoy-test get secret envoy-client-tls &>/dev/null; then
    echo "   (envoy-client-tls already exists in cluster; Envoy may still work.)"
  else
    echo "   Envoy deploy expects envoy-client-tls; create the cert and re-run this script."
    exit 1
  fi
fi

# Restart Envoy so it mounts envoy-client-tls and presents the Envoy client cert to gRPC backends.
if kubectl get deployment envoy-test -n envoy-test &>/dev/null; then
  kubectl -n envoy-test rollout restart deployment/envoy-test
  kubectl -n envoy-test rollout status deployment/envoy-test --timeout=90s || true
  echo "Envoy restarted (mTLS client cert CN=envoy will be used for upstream connections)."
fi