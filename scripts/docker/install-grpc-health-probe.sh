#!/bin/sh
# Install grpc-health-probe into the image (K8s exec probes). Build context: repo root.
# GitHub release URLs occasionally return 5xx (e.g. 504); curl retries + outer attempts cover Colima/CI flakes.
#
# Env: GRPC_HEALTH_PROBE_VERSION (default v0.4.24)
# Arg: optional output path (default /usr/local/bin/grpc-health-probe)

set -eu

VERSION="${GRPC_HEALTH_PROBE_VERSION:-v0.4.24}"
OUT="${1:-/usr/local/bin/grpc-health-probe}"
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64) BINARY_ARCH=amd64 ;;
  arm64) BINARY_ARCH=arm64 ;;
  *) BINARY_ARCH=amd64 ;;
esac

URL="https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${VERSION}/grpc_health_probe-linux-${BINARY_ARCH}"

attempt=1
while [ "$attempt" -le 15 ]; do
  if curl -fSL \
    --connect-timeout 30 \
    --max-time 300 \
    --retry 8 \
    --retry-delay 5 \
    --retry-all-errors \
    -o "${OUT}.tmp" \
    "$URL"; then
    mv "${OUT}.tmp" "$OUT"
    chmod +x "$OUT"
    exit 0
  fi
  rm -f "${OUT}.tmp" 2>/dev/null || true
  attempt=$((attempt + 1))
  sleep 8
done

echo "install-grpc-health-probe: failed to download after multiple attempts: ${URL}" >&2
exit 1
