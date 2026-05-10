#!/usr/bin/env bash
# Stop proof / preflight / dev orchestration jobs (processes only). Does NOT restart Colima — bootstrap owns that.
# Invoked by: make kill-all   or   Phase 0 prelude inside scripts/bootstrap-cluster.sh
set -euo pipefail

echo "🔪 Killing any running proof / preflight / dev jobs..."
# Do NOT pkill validate-full-stack-proof / validate-*-proof / full-stack-proof: bootstrap runs inside
# those orchestrators; matching them would SIGPIPE-kill the parent `make full-stack-proof` run.
pkill -f 'test-dev-cold-start' 2>/dev/null || true
pkill -f 'preflight-lab' 2>/dev/null || true
pkill -f 'run-preflight-scale-and-all-suites' 2>/dev/null || true
pkill -f 'run-preflight' 2>/dev/null || true

echo "🧹 Waiting for process tree to settle..."
sleep 2

echo "✅ Proof/preflight processes cleared (Colima unchanged — use BOOTSTRAP_CONFIRM=yes make bootstrap for control-plane reset)."
