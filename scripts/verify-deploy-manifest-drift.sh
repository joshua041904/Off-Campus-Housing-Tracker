#!/usr/bin/env bash
# Compare current kustomize build SHA256 to the last applied manifest recorded by deploy-dev.sh.
# Fails if bench_logs/last-deployed-kustomize-manifest.sha256 is missing or differs.
#
# Usage: HOUSING_NS=… ./scripts/verify-deploy-manifest-drift.sh [OVERLAY_DIR]
# Env:
#   DEPLOY_OVERLAY — relative to infra/k8s (default overlays/dev) when OVERLAY_DIR not passed as arg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OVERLAY_REL="${1:-${DEPLOY_OVERLAY:-overlays/dev}}"
OVERLAY_DIR="$REPO_ROOT/infra/k8s/$OVERLAY_REL"
STAMP="$REPO_ROOT/bench_logs/last-deployed-kustomize-manifest.sha256"

[[ -d "$OVERLAY_DIR" ]] || { echo "Not a directory: $OVERLAY_DIR" >&2; exit 1; }
[[ -f "$STAMP" ]] || {
  echo "::error::No recorded manifest checksum at $STAMP — run deploy-dev once or set SKIP if intentional" >&2
  exit 1
}

_prev="$(tr -d '[:space:]' <"$STAMP" || true)"
[[ -n "$_prev" ]] || { echo "::error::Empty checksum in $STAMP" >&2; exit 1; }

_now="$(
  if command -v kustomize &>/dev/null 2>&1; then kustomize build "$OVERLAY_DIR"
  else kubectl kustomize "$OVERLAY_DIR"; fi | if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | awk '{print $1}'
)"

if [[ "$_now" != "$_prev" ]]; then
  echo "::error::Deploy manifest drift: current kustomize SHA256=$_now recorded=$_prev" >&2
  echo "  overlay=$OVERLAY_REL stamp=$STAMP" >&2
  exit 1
fi

echo "✅ kustomize manifest matches last applied checksum ($_now)"
