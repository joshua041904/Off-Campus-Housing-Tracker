#!/usr/bin/env bash
# Concurrent HTTP/3 requests to stress QUIC stream limits (curl 55 / resets under load).
#
# Usage:
#   OCH_H3_URL=https://off-campus-housing.test/api/healthz \
#   OCH_H3_CA=certs/dev-root.pem \
#   CONCURRENCY=200 \
#   ./scripts/transport/http3-concurrent-curl-stress.sh
#
# Expectation: after Caddy/Envoy tuning, successes should approach CONCURRENCY; before tuning,
# many failures often indicate stream / flow-control saturation.
set -euo pipefail

URL="${OCH_H3_URL:-https://off-campus-housing.test/api/healthz}"
CA="${OCH_H3_CA:-certs/dev-root.pem}"
CONCURRENCY="${CONCURRENCY:-200}"

if [[ ! -f "$CA" ]]; then
  echo "Missing CA file: $CA (set OCH_H3_CA)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found" >&2
  exit 1
fi

if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$CONCURRENCY" -lt 1 ]]; then
  echo "CONCURRENCY must be a positive integer" >&2
  exit 1
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/och-h3-stress.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# One file per in-flight request: 1 = success, 0 = failure (macOS bash 3.2–safe, no process substitution).
for ((i = 1; i <= CONCURRENCY; i++)); do
  (
    if curl -fsS --http3-only --cacert "$CA" -o /dev/null "$URL" >/dev/null 2>&1; then
      printf '1' >"$tmp/r.$i"
    else
      printf '0' >"$tmp/r.$i"
    fi
  ) &
done
wait

success=0
fail=0
for ((i = 1; i <= CONCURRENCY; i++)); do
  line="$(cat "$tmp/r.$i" 2>/dev/null || printf '0')"
  if [[ "$line" == "1" ]]; then
    ((success++)) || true
  else
    ((fail++)) || true
  fi
done

echo "URL:       $URL"
echo "CA:        $CA"
echo "Concurrent: $CONCURRENCY"
echo "Success:   $success"
echo "Failures:  $fail"

if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
