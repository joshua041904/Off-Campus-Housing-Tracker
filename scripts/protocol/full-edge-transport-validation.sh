#!/usr/bin/env bash
# Aggregate H2/H3 strict + gRPC checks for all housing services → bench_logs/transport-lab/*.json
# Requires: kubectl, curl, cluster + Caddy (same as test-microservices-http2-http3-housing.sh).
#
# Usage: ./scripts/protocol/full-edge-transport-validation.sh [out-dir]
# Env: CAPTURE_ENVOY_RETRIES=1 — append Envoy log hints to each service JSON
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
OUT_DIR="${1:-$REPO_ROOT/bench_logs/transport-lab}"
mkdir -p "$OUT_DIR/per-service"

# shellcheck source=scripts/lib/http3.sh
[[ -f "$SCRIPT_DIR/../lib/http3.sh" ]] && source "$SCRIPT_DIR/../lib/http3.sh" || true

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

export REPO_ROOT
export NS="${NS:-off-campus-housing-tracker}"
export HOST="${HOST:-off-campus-housing.test}"

say "Full edge transport validation → $OUT_DIR"

any_fail=0

# service|gateway_health_path|k8s_deploy|grpc_port|grpc_probe_service
while IFS='|' read -r sk path deploy gport gsvc; do
  [[ -z "$sk" ]] && continue
  [[ "$sk" =~ ^# ]] && continue
  export SERVICE_KEY="$sk"
  export GATEWAY_HEALTH_PATH="$path"
  export K8S_DEPLOY="$deploy"
  export GRPC_PORT="${gport:-0}"
  export GRPC_PROBE_SERVICE="${gsvc:-}"
  out_json="$OUT_DIR/per-service/${sk}.json"
  export OUT_JSON="$out_json"
  say "=== $sk ==="
  write_fail_json() {
    node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({service:process.argv[2],overall_ok:false,errors:['protocol script exited before summary']},null,2)+'\n')" "$out_json" "$sk"
  }
  if bash "$SCRIPT_DIR/test-service-protocol.sh"; then
    ok "$sk protocol checks passed"
  else
    warn "$sk protocol checks failed (see $out_json)"
    any_fail=1
    [[ -f "$out_json" ]] || write_fail_json
  fi
done <<'MATRIX'
auth|/api/auth/healthz|auth-service|50061|auth.AuthService
listings|/api/listings/healthz|listings-service|50062|listings.ListingsService
booking|/api/booking/healthz|booking-service|50063|booking.BookingService
messaging|/api/messaging/healthz|messaging-service|50064|messaging.v1.MessagingService
trust|/api/trust/healthz|trust-service|50066|trust.TrustService
analytics|/api/analytics/healthz|analytics-service|50067|analytics.AnalyticsService
media|/api/media/healthz|media-service|50068|media.MediaService
notification|/api/notification/healthz|notification-service|50065|notification.NotificationService
gateway|/api/healthz|api-gateway|0|
MATRIX

# Downgrade / integrity roll-up
OUT_DIR="$OUT_DIR" ANY_FAIL="$any_fail" node -e '
const fs = require("fs");
const outDir = process.env.OUT_DIR;
const anyFail = Number(process.env.ANY_FAIL || "0");
const dir = fs.readdirSync(`${outDir}/per-service`).filter((f) => f.endsWith(".json"));
const downgrades = [];
const integrity = { http2_all_ok: true, http3_strict_all_ok_or_skipped: true, any_downgrade: false };
for (const f of dir) {
  const j = JSON.parse(fs.readFileSync(`${outDir}/per-service/${f}`, "utf8"));
  if (j.downgrade_detected) {
    downgrades.push({ service: j.service, detail: j.errors || [] });
    integrity.any_downgrade = true;
  }
  if (!j.http2_health_ok) integrity.http2_all_ok = false;
  if (!j.http3_strict_ok && !j.http3_skipped) integrity.http3_strict_all_ok_or_skipped = false;
}
fs.writeFileSync(
  `${outDir}/downgrade-detection-report.json`,
  JSON.stringify({ generated_at: new Date().toISOString(), downgrades, count: downgrades.length }, null, 2) + "\n",
);
fs.writeFileSync(
  `${outDir}/protocol-integrity-report.json`,
  JSON.stringify({ generated_at: new Date().toISOString(), ...integrity, exit_would_fail: anyFail }, null, 2) + "\n",
);
'

# Master transport-validation-report.json
_all_ok=0
[[ "$any_fail" -eq 0 ]] && _all_ok=1
node -e '
const fs = require("fs");
const outDir = process.argv[1];
const allOk = process.argv[2] === "1";
const services = {};
for (const f of fs.readdirSync(`${outDir}/per-service`).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(fs.readFileSync(`${outDir}/per-service/${f}`, "utf8"));
  services[j.service] = j;
}
const doc = {
  generated_at: new Date().toISOString(),
  all_ok: allOk,
  services,
};
fs.writeFileSync(`${outDir}/transport-validation-report.json`, JSON.stringify(doc, null, 2) + "\n");
' "$OUT_DIR" "$_all_ok"

ok "Wrote $OUT_DIR/transport-validation-report.json"
exit "$any_fail"
