#!/usr/bin/env bash
# OCH canonical dev entrypoint: one command → Colima + Compose + deps + certs + images + cluster/Kafka/edge + health + state file.
# Edge SNI / hostname defaults to off-campus-housing.test (not record.test).
#
# Implementation delegates to scripts/dev-orchestrator.sh; this wrapper sets OCH defaults and runs post-gates.
#
# Env (see also dev-orchestrator.sh):
#   OCH_EDGE_HOSTNAME — default off-campus-housing.test
#   RESTORE_BACKUP_DIR — e.g. latest or backups/all-8-<ts> for all-8 Postgres restore (no infra/db SQL bootstrap).
#   DEV_UP_SKIP_AUTO_RESTORE=1 — skip auto pick of newest backups/all-8-* (use infra/db bootstrap via bring-up-cluster only).
#   DEV_UP_SKIP_RECENT_IMAGE_BUILD=1 — skip make images when all default :dev images + webapp:dev exist AND oldest image <10m (override with FORCE_IMAGE_REBUILD=1)
#   DEV_SKIP_HEALTH=1 — skip scripts/dev-health-check.sh at end
#   DEV_UP_SKIP_STATE_MACHINE=1 — skip scripts/dev-up-state-machine.sh prelude (S1–S4 guards)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export OCH_EDGE_HOSTNAME="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"

# Default: restore from newest all-8 (or all-7) backup when present — avoids infra/db bootstrap drift vs dumps.
if [[ "${DEV_UP_SKIP_AUTO_RESTORE:-0}" != "1" ]] && [[ -z "${RESTORE_BACKUP_DIR:-}" ]]; then
  shopt -s nullglob
  _bak=( "$REPO_ROOT"/backups/all-8-* "$REPO_ROOT"/backups/all-7-* )
  shopt -u nullglob
  if [[ "${#_bak[@]}" -gt 0 ]]; then
    export RESTORE_BACKUP_DIR=latest
    echo "ℹ️  Auto-restore: RESTORE_BACKUP_DIR=latest (newest backups/all-8-* or all-7-*). DEV_UP_SKIP_AUTO_RESTORE=1 to use infra/db SQL bootstrap instead."
  fi
fi

if [[ "${DEV_UP_SKIP_RECENT_IMAGE_BUILD:-0}" == "1" ]] && [[ "${FORCE_IMAGE_REBUILD:-0}" != "1" ]]; then
  export SKIP_BUILD="${SKIP_BUILD:-}"
  if [[ -z "${SKIP_BUILD:-}" ]] && command -v docker >/dev/null 2>&1; then
    _och_age_names=()
    if [[ -f "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh" ]]; then
      # shellcheck source=scripts/lib/och-housing-docker-services-default.sh
      source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"
      for _n in $HOUSING_DOCKER_SERVICES_DEFAULT webapp; do
        _och_age_names+=("${_n}:dev")
      done
    else
      _och_age_names=(api-gateway:dev webapp:dev)
    fi
    _och_dev_skip_build_images_present=1
    for _img in "${_och_age_names[@]}"; do
      if ! docker image inspect "$_img" &>/dev/null; then
        _och_dev_skip_build_images_present=0
        break
      fi
    done
    export OCH_AGE_IMAGE_LIST="${_och_age_names[*]}"
    if [[ "$_och_dev_skip_build_images_present" -eq 1 ]] && python3 - <<'PY'
import json, os, subprocess, sys
from datetime import datetime, timezone
imgs = (os.environ.get("OCH_AGE_IMAGE_LIST") or "").split()
if not imgs:
    sys.exit(1)
oldest = None
for name in imgs:
    r = subprocess.run(["docker", "image", "inspect", name], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(1)
    j = json.loads(r.stdout)[0]
    created = (j.get("Created") or "").replace("Z", "+00:00")
    dt = datetime.fromisoformat(created)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    oldest = dt if oldest is None or dt < oldest else oldest
age = (datetime.now(timezone.utc) - oldest).total_seconds()
# All images must exist (shell); skip build only if the *oldest* is still <10m (no stale partial set).
sys.exit(0 if age < 600 else 1)
PY
    then
      export SKIP_BUILD=1
      echo "ℹ️  DEV_UP_SKIP_RECENT_IMAGE_BUILD=1 and all default :dev images + webapp exist and oldest <10m → SKIP_BUILD=1 (FORCE_IMAGE_REBUILD=1 to rebuild)"
    fi
  fi
fi

chmod +x "$SCRIPT_DIR/dev-orchestrator.sh" "$SCRIPT_DIR/dev-health-check.sh" "$SCRIPT_DIR/wait-for-housing-service-endpoints.sh" "$SCRIPT_DIR/dev-up-state-machine.sh" 2>/dev/null || true

# Cold-start (and similar) stops Colima immediately before `make dev`; the state machine runs *before*
# dev-orchestrator's ensure_colima_running. Bring Colima + Docker up first so S2/S3 do not false-fail.
_och_req_colima="${REQUIRE_COLIMA:-}"
if [[ -z "${_och_req_colima}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then _och_req_colima=1; else _och_req_colima=0; fi
fi
if [[ "${DEV_UP_SKIP_STATE_MACHINE:-0}" != "1" ]] && [[ "${DRY_RUN:-0}" != "1" ]] && [[ "${TEST_BREAK_DOCKER:-0}" != "1" ]] \
  && [[ "$_och_req_colima" == "1" ]] && command -v colima >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    echo "ℹ️  Docker unreachable before dev-up state machine (e.g. after cold-start Colima stop) — ensuring Colima…"
    if ! colima status 2>/dev/null | grep -qi 'colima is running' \
      && ! colima list 2>/dev/null | grep -Eq '^default[[:space:]]+Running\b'; then
      CPU="${CPU:-12}" MEMORY="${MEMORY:-16}" DISK="${DISK:-256}" COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
      colima start --cpu "$CPU" --memory "$MEMORY" --disk "$DISK" --network-address --with-kubernetes --kubernetes-version "$COLIMA_K3S_VERSION"
    fi
    _och_dwait=0
    while ! docker info >/dev/null 2>&1; do
      _och_dwait=$((_och_dwait + 1))
      if [[ "$_och_dwait" -gt 120 ]]; then
        echo "❌ Docker still unreachable after Colima (waited ~240s)" >&2
        exit 1
      fi
      sleep 2
    done
    echo "✅ Docker daemon reachable (post–Colima ensure)"
  fi
fi

if [[ "${DEV_UP_SKIP_STATE_MACHINE:-0}" != "1" ]] && [[ "${DRY_RUN:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/dev-up-state-machine.sh" || exit $?
fi
bash "$SCRIPT_DIR/dev-orchestrator.sh" "$@"
_orch_st=$?

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  exit "$_orch_st"
fi
[[ "$_orch_st" -eq 0 ]] || exit "$_orch_st"

if [[ "${DEV_SKIP_HEALTH:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/dev-health-check.sh"
fi

export REPO_ROOT
python3 - <<'PY'
import json, os, subprocess, time
bench = os.path.join(os.environ["REPO_ROOT"], "bench_logs")
os.makedirs(bench, exist_ok=True)
path = os.path.join(bench, "dev-state.json")
colima = "unknown"
try:
    r = subprocess.run(["colima", "status"], capture_output=True, text=True, timeout=15)
    colima = "running" if "Running" in (r.stdout or "") else (r.stdout or r.stderr or "")[:200]
except OSError:
    colima = "unavailable"
obj = {
    "och_edge_hostname": os.environ.get("OCH_EDGE_HOSTNAME", "off-campus-housing.test"),
    "housing_ns": os.environ.get("HOUSING_NS", "off-campus-housing-tracker"),
    "colima": colima.strip(),
    "timestamp_unix": int(time.time()),
    "entrypoint": "scripts/dev-up.sh",
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2, sort_keys=True)
print(f"✅ wrote {path}")
PY
