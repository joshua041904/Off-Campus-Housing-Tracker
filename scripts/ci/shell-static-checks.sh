#!/usr/bin/env bash
# Static checks for CI: kustomize render (housing base + dev + Kafka bundle) and
# bash -n over repo scripts. Invoked by `make verify-ci` (see .github/workflows/ci.yml).
#
# Intentionally mirrors `make dev-onboard-lite` so CI and local dev share one contract.
# infra/k8s/overlays/prod is not included here until kustomize namespace transforms are fixed.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
exec make dev-onboard-lite
