#!/usr/bin/env bash
# Canonical curl wrapper for **edge / gateway** traffic: always sends `x-suite` (default bash).
# Source from any script:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=scripts/lib/curl-with-suite.sh
#   source "$REPO_ROOT/scripts/lib/curl-with-suite.sh"
#   och_curl_suite -sfS --cacert "$CA" "https://off-campus-housing.test/api/readyz"
# Infra / bootstrap / HAProxy-style probes (strict gateway — no x-suite required):
#   och_curl_infra -sfS --cacert "$CA" "https://off-campus-housing.test/api/readyz"
# In-pod loopback to gateway :4020 (strict — no x-suite required):
#   och_curl_internal -sfS "http://127.0.0.1:4020/healthz"
#
# Env: OCH_X_SUITE — vitest | bash | k6 | playwright (default bash for shell probes).
set -euo pipefail

: "${OCH_X_SUITE:=bash}"
if [[ -z "${OCH_X_SUITE// }" ]]; then
  echo "❌ OCH_X_SUITE is empty; refusing unlabeled gateway traffic." >&2
  return 2 2>/dev/null || exit 2
fi

och_curl_suite() {
  curl -H "x-suite: ${OCH_X_SUITE}" "$@"
}

och_curl_infra() {
  curl -H "x-traffic-class: infra" "$@"
}

och_curl_internal() {
  curl -H "x-traffic-class: internal" "$@"
}
