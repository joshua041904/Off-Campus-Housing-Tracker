#!/usr/bin/env bash
# Replace host.docker.internal / host.lima.internal in ConfigMap app-config with the Colima VM default
# gateway IP (same network segment as host Postgres/Redis from the pod’s view). Avoids flaky DNS
# (EAI_AGAIN) for DB URLs while keeping a single logical hostname in git (base app-config).
#
# Discover IP (override with DB_HOST_GATEWAY_IP=...):
#   colima ssh -- ip route show default
#   # default via 192.168.5.2 ...
#
# Usage (repo root, kubectl context colima, Colima running):
#   ./scripts/colima-patch-app-config-db-host-to-gateway.sh
#   DB_HOST_GATEWAY_IP=192.168.5.2 HOUSING_NS=off-campus-housing-tracker ./scripts/colima-patch-app-config-db-host-to-gateway.sh
#
# After apply, restart app pods if needed: ./scripts/rebuild-och-images-and-rollout.sh with ROLLOUT only, or kubectl rollout restart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi

GW="${DB_HOST_GATEWAY_IP:-}"
if [[ -z "$GW" ]]; then
  if ! command -v colima >/dev/null 2>&1 || ! colima status &>/dev/null; then
    warn "Colima not running — set DB_HOST_GATEWAY_IP explicitly (e.g. 192.168.5.2)"
    exit 1
  fi
  GW="$(colima ssh -- ip route show default 2>/dev/null | awk '{print $3; exit}' | tr -d '\r')"
fi

if [[ ! "$GW" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid gateway IP: '$GW'" >&2
  exit 1
fi

if ! kubectl get configmap app-config -n "$NS" -o name &>/dev/null; then
  echo "ConfigMap app-config not found in $NS" >&2
  exit 1
fi

say "Patching app-config in $NS: host.docker.internal / host.lima.internal → $GW"

python3 <<PY
import json, subprocess, sys

ns = "$NS"
gw = "$GW"
raw = subprocess.check_output(
    ["kubectl", "get", "configmap", "app-config", "-n", ns, "-o", "json"],
    text=True,
)
obj = json.loads(raw)
data = obj.get("data") or {}
replacements = 0
for k, v in list(data.items()):
    if not isinstance(v, str):
        continue
    new = v.replace("host.docker.internal", gw).replace("host.lima.internal", gw)
    if new != v:
        replacements += 1
        data[k] = new
if replacements == 0:
    print("No host.docker.internal / host.lima.internal in app-config data keys (already patched?)", file=sys.stderr)
    sys.exit(0)
meta = obj.get("metadata") or {}
for drop in ("resourceVersion", "uid", "creationTimestamp", "managedFields"):
    meta.pop(drop, None)
obj["metadata"] = meta
obj["data"] = data
subprocess.run(
    ["kubectl", "apply", "-f", "-", "-n", ns],
    input=json.dumps(obj),
    text=True,
    check=True,
)
print(f"Patched {replacements} keys")
PY

ok "app-config applied (DATABASE_*, POSTGRES_*, REDIS_URL now use $GW)"
echo "Restart workloads to pick up env: kubectl rollout restart deploy -n $NS <name>"
