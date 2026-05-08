#!/usr/bin/env bash
# Periodic or manual bootstrap contract drift check.
# Runs scripts/verify-bootstrap-state.mjs (VERIFY_BOOTSTRAP_CONTEXT=drift) and writes
#   bench_logs/drift-report-<stamp>.json
# plus bench_logs/bootstrap_drift.prom (aggregate gauge; 1 = verify failed).
#
# Env: VERIFY_BOOTSTRAP_STATE_SKIP=1 — no-op. BOOTSTRAP_DRIFT_REPORT_DIR — output dir (default bench_logs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${VERIFY_BOOTSTRAP_STATE_SKIP:-0}" == "1" ]]; then
  echo "VERIFY_BOOTSTRAP_STATE_SKIP=1 — bootstrap-drift-detector skipped"
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BOOTSTRAP_DRIFT_REPORT_DIR:-$REPO_ROOT/bench_logs}"
mkdir -p "$OUT_DIR"
VERIFY_JSON="$OUT_DIR/.bootstrap-verify-latest.json"
REPORT="$OUT_DIR/drift-report-$STAMP.json"

command -v node >/dev/null 2>&1 || { echo "❌ node required on PATH"; exit 1; }

set +e
VERIFY_BOOTSTRAP_CONTEXT=drift node "$SCRIPT_DIR/verify-bootstrap-state.mjs" --json-out "$VERIFY_JSON"
VERIFY_RC=$?
set -e

SEVERITY=0
[[ "$VERIFY_RC" -ne 0 ]] && SEVERITY=2

_AT_RISK_JSON="{}"
if [[ "$VERIFY_RC" -ne 0 ]] && [[ -f "$VERIFY_JSON" ]]; then
  _AT_RISK_JSON="$(node "$SCRIPT_DIR/bootstrap-phase-guard.mjs" --at-risk-for-failed-verify "$VERIFY_JSON" 2>/dev/null)"
fi
export _AT_RISK_JSON

export _DRIFT_VERIFY_RC="$VERIFY_RC"
export _DRIFT_SEVERITY="$SEVERITY"
export _DRIFT_STAMP="$STAMP"
export _DRIFT_VERIFY_JSON="$VERIFY_JSON"
export _DRIFT_REPORT="$REPORT"

python3 <<'PY'
import json, os, pathlib

verify_rc = int(os.environ["_DRIFT_VERIFY_RC"])
severity = int(os.environ["_DRIFT_SEVERITY"])
stamp = os.environ["_DRIFT_STAMP"]
verify_path = pathlib.Path(os.environ["_DRIFT_VERIFY_JSON"])
out_path = pathlib.Path(os.environ["_DRIFT_REPORT"])

artifact_lock = ""
art = pathlib.Path("bench_logs/bootstrap-artifact.json")
if art.is_file():
    try:
        d = json.loads(art.read_text())
        artifact_lock = (d.get("state_contract") or {}).get("workspace", {}).get("pnpm_lock_sha256") or ""
    except Exception:
        pass

crypto_fp = ""
if verify_path.is_file():
    try:
        d = json.loads(verify_path.read_text())
        crypto_fp = (d.get("phase_results") or {}).get("crypto", {}).get("dev_root_sha256") or ""
    except Exception:
        pass

meaning = "none"
if severity >= 3:
    meaning = "security_root_drift"
elif severity >= 2:
    meaning = "contract_violation"
elif severity >= 1:
    meaning = "non_fatal"

at_risk = {}
try:
    at_risk = json.loads(os.environ.get("_AT_RISK_JSON") or "{}")
except Exception:
    at_risk = {}

doc = {
    "drift_report_version": "v1.0",
    "timestamp": stamp,
    "verify_exit_code": verify_rc,
    "severity": severity,
    "severity_meaning": meaning,
    "bootstrap_artifact_pnpm_lock_sha256": artifact_lock or None,
    "verify_dev_root_sha256": crypto_fp or None,
    "verify_json": str(verify_path),
    "dependency_impact": at_risk,
}
out_path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PY
unset _DRIFT_VERIFY_RC _DRIFT_SEVERITY _DRIFT_STAMP _DRIFT_VERIFY_JSON _DRIFT_REPORT _AT_RISK_JSON

echo "Wrote $REPORT"

PROM="$OUT_DIR/bootstrap_drift.prom"
{
  echo "# TYPE bootstrap_drift gauge"
  echo "# HELP bootstrap_drift 1 if verify-bootstrap-state failed else 0"
  if [[ "$VERIFY_RC" -ne 0 ]]; then
    echo 'bootstrap_drift{phase="aggregate"} 1'
  else
    echo 'bootstrap_drift{phase="aggregate"} 0'
  fi
} >"$PROM"
echo "Updated $PROM"

if [[ "$VERIFY_RC" -ne 0 ]]; then
  echo "❌ verify-bootstrap-state failed (exit $VERIFY_RC) — drift severity $SEVERITY (contract violation)"
  exit 1
fi
exit 0
