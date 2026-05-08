#!/usr/bin/env bash
# CI: workspace + openssl crypto contract (no Kubernetes). Invoked from .github/workflows/ci.yml.
# Installs a JRE for keytool, builds kafka-contract dist, alignment venv, generates dev certs, runs VERIFY_BOOTSTRAP_CONTEXT=ci.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ "${VERIFY_BOOTSTRAP_STATE_SKIP:-0}" == "1" ]]; then
  echo "VERIFY_BOOTSTRAP_STATE_SKIP=1 — skipping"
  exit 0
fi

if command -v apt-get >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jre-headless
fi

command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm required"; exit 1; }
pnpm install --frozen-lockfile
pnpm --filter kafka-contract run build
make kafka-alignment-report-venv
DEV_CERTS_ENSURE_ONLY=1 bash scripts/dev-generate-certs.sh
mkdir -p bench_logs
VERIFY_BOOTSTRAP_CONTEXT=ci node scripts/verify-bootstrap-state.mjs --json-out bench_logs/bootstrap-state-verify-ci.json
echo "✅ verify-bootstrap-state (ci context) OK"
