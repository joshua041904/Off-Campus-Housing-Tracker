#!/usr/bin/env bash
# Static gate: k6/load scripts must not default BASE_URL to a raw https://<IP> (breaks TLS SNI for HTTP/3).
# OCH edge contract: hostname off-campus-housing.test + --resolve / K6_RESOLVE to LB IP.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

hits="$(grep -rE --include='*.js' "BASE_URL.*['\"]https://[0-9]{1,3}\\." scripts/load 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  echo "❌ Raw-IP https BASE_URL default in scripts/load (use https://off-campus-housing.test + resolve):"
  printf '%s\n' "$hits"
  exit 1
fi

echo "✅ QUIC hostname invariant: no raw-IP BASE_URL defaults under scripts/load/."
