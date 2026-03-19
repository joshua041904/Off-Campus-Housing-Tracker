# file: scripts/strict-tls-bootstrap.sh  (re-run to ensure secrets exist in BOTH namespaces)
#!/usr/bin/env bash
set -euo pipefail
# Run from repo root. dev-root.pem, off-campus-housing.local.crt, off-campus-housing.local.key must be in ./certs/
# For Envoy→backend mTLS we also need a dedicated Envoy client cert (CN=envoy). Generate with:
#   KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh   # persists certs/dev-root.key
#   ./scripts/generate-envoy-client-cert.sh                         # creates certs/envoy-client.crt|.key
# After this script: Envoy presents the Envoy client cert to gRPC backends (not the edge leaf).
# If you see "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure",
# ensure envoy-client-tls exists and Envoy deploy uses it (envoy.crt/envoy.key).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

LEAF_CRT="$ROOT/certs/off-campus-housing.local.crt"
LEAF_KEY="$ROOT/certs/off-campus-housing.local.key"
CA_PEM="$ROOT/certs/dev-root.pem"
if [[ ! -f "$LEAF_CRT" ]] || [[ ! -f "$LEAF_KEY" ]]; then
  echo "ERROR: Caddy/ingress certs missing. Create them first from repo root:" >&2
  echo "  ./scripts/dev-generate-certs.sh" >&2
  echo "  (or: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh)" >&2
  echo "Then re-run: ./scripts/strict-tls-bootstrap.sh" >&2
  exit 1
fi
if [[ ! -f "$CA_PEM" ]]; then
  echo "ERROR: CA cert missing: $CA_PEM. Run: ./scripts/dev-generate-certs.sh" >&2
  exit 1
fi

# Caddy terminates TLS at the edge; off-campus-housing-local-tls is the leaf cert. Secret type is immutable — delete then create if replacing.
LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-off-campus-housing-local-tls}"
kubectl create namespace off-campus-housing-tracker --dry-run=client -o yaml | kubectl apply -f -
for ns in ingress-nginx off-campus-housing-tracker; do
  kubectl -n "$ns" delete secret "$LEAF_TLS_SECRET" --ignore-not-found
  kubectl -n "$ns" create secret tls "$LEAF_TLS_SECRET" \
    --cert="$LEAF_CRT" --key="$LEAF_KEY"
done
kubectl -n ingress-nginx create secret generic dev-root-ca \
  --from-file=dev-root.pem="$CA_PEM" \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl -n off-campus-housing-tracker create secret generic dev-root-ca \
  --from-file=dev-root.pem="$CA_PEM" \
  -o yaml --dry-run=client | kubectl apply -f -
# Backends (auth-service, etc.) use secret "service-tls" with tls.crt, tls.key, ca.crt for TLS server + client cert verification (real mTLS).
kubectl -n off-campus-housing-tracker delete secret service-tls --ignore-not-found
kubectl -n off-campus-housing-tracker create secret generic service-tls \
  --from-file=tls.crt="$LEAF_CRT" \
  --from-file=tls.key="$LEAF_KEY" \
  --from-file=ca.crt="$CA_PEM"
kubectl create namespace envoy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl -n envoy-test create secret generic dev-root-ca \
  --from-file=dev-root.pem="$CA_PEM" \
  -o yaml --dry-run=client | kubectl apply -f -
# Envoy uses a dedicated client cert (CN=envoy), not the edge leaf, so backends see a proper client identity.
if [[ -f "$ROOT/certs/envoy-client.crt" ]] && [[ -f "$ROOT/certs/envoy-client.key" ]]; then
  kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found
  kubectl -n envoy-test create secret generic envoy-client-tls \
    --from-file=envoy.crt="$ROOT/certs/envoy-client.crt" \
    --from-file=envoy.key="$ROOT/certs/envoy-client.key"
  echo "Envoy client secret envoy-client-tls created (CN=envoy)."
else
  echo "⚠️  certs/envoy-client.crt or certs/envoy-client.key missing. Run: ./scripts/generate-envoy-client-cert.sh (requires certs/dev-root.key), then re-run this script for Envoy mTLS."
  if kubectl -n envoy-test get secret envoy-client-tls &>/dev/null; then
    echo "   (envoy-client-tls already exists in cluster; Envoy may still work.)"
  else
    echo "   Envoy deploy will need envoy-client-tls; create the cert and re-run this script when using Envoy."
  fi
fi

# Restart Envoy so it mounts envoy-client-tls and presents the Envoy client cert to gRPC backends.
if kubectl get deployment envoy-test -n envoy-test &>/dev/null; then
  kubectl -n envoy-test rollout restart deployment/envoy-test
  kubectl -n envoy-test rollout status deployment/envoy-test --timeout=90s || true
  echo "Envoy restarted (mTLS client cert CN=envoy will be used for upstream connections)."
fi