#!/usr/bin/env bash
# Rebuild api-gateway (E2E shaper + Redis cluster-weight Lua + watchdog poll) and transport-watchdog sidecar, load into Colima, rollout.
# After images: kubectl apply -k infra/k8s/overlays/dev
#
# Usage (repo root):
#   ./scripts/rebuild-traffic-control-stack.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export SERVICES="api-gateway transport-watchdog"
exec "$ROOT/scripts/rebuild-och-images-and-rollout.sh"
