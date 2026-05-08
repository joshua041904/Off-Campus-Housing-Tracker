#!/usr/bin/env bash
# Assert a rendered kustomize manifest includes every core housing Deployment (client dry-run).
# No temp files: pass manifest on stdin with --from-stdin, or stream from kustomize build | this script.
#
# Usage:
#   kustomize build infra/k8s/overlays/dev | ./scripts/verify-kustomize-overlay-core-deployments.sh --from-stdin
#   ./scripts/verify-kustomize-overlay-core-deployments.sh [OVERLAY_DIR]   # builds overlay and streams to kubectl dry-run
#
# Env:
#   VERIFY_MANIFEST_LABEL — optional label in messages when using --from-stdin (default: stdin)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FROM_STDIN=0
while [[ "${1:-}" == -* ]]; do
  case "$1" in
    --from-stdin)
      FROM_STDIN=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$FROM_STDIN" == "1" ]]; then
  LABEL="${VERIFY_MANIFEST_LABEL:-stdin}"
else
  OVERLAY_DIR="${1:-$REPO_ROOT/infra/k8s/overlays/dev}"
  LABEL="${VERIFY_MANIFEST_LABEL:-${OVERLAY_DIR##*/}}"
fi

REQUIRED=(
  ollama
  api-gateway
  auth-service
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
)

_och_kustomize_build() {
  if command -v kustomize &>/dev/null 2>&1; then
    kustomize build "$OVERLAY_DIR"
  else
    kubectl kustomize "$OVERLAY_DIR"
  fi
}

if ! command -v kubectl &>/dev/null; then
  echo "kubectl required for dry-run validation" >&2
  exit 1
fi

_dry_out=""
if [[ "$FROM_STDIN" == "1" ]]; then
  if ! _dry_out="$(kubectl apply -f - --dry-run=client -o name 2>&1)"; then
    echo "::error::kubectl apply --dry-run=client failed for manifest stream (label=$LABEL)" >&2
    echo "$_dry_out" >&2
    exit 1
  fi
else
  [[ -d "$OVERLAY_DIR" ]] || { echo "Not a directory: $OVERLAY_DIR" >&2; exit 1; }
  if ! _dry_out="$(_och_kustomize_build | kubectl apply -f - --dry-run=client -o name 2>&1)"; then
    echo "::error::kustomize build or kubectl dry-run failed for $OVERLAY_DIR" >&2
    echo "$_dry_out" >&2
    exit 1
  fi
fi

_missing=()
for dep in "${REQUIRED[@]}"; do
  if ! printf '%s\n' "$_dry_out" | grep -qFx "deployment.apps/${dep}"; then
    _missing+=("$dep")
  fi
done

if [[ ${#_missing[@]} -gt 0 ]]; then
  echo "::error::Manifest missing Deployment(s): ${_missing[*]} (label=$LABEL)" >&2
  echo "  (kubectl dry-run did not include deployment.apps/<name>)" >&2
  echo "  Hint: ensure ../../base stays in overlays/dev/kustomization.yaml resources." >&2
  exit 1
fi

echo "✅ manifest contains core Deployments (label=$LABEL)"
