#!/usr/bin/env bash
# Remove unused contexts and clusters from kubeconfig for hygiene (faster kubectl/API checks).
# Keeps only the current context and its cluster/user. Backs up before modifying.
# Run: ./scripts/clean-unused-kubeconfig.sh
# Dry run (show what would be kept): DRY_RUN=1 ./scripts/clean-unused-kubeconfig.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Only ever slim ~/.kube/config — never overwrite Colima's kubeconfig (can break API server reachability).
COLIMA_KUBE="$HOME/.colima/default/kubernetes/kubeconfig"
if [[ -n "${KUBECONFIG:-}" ]] && [[ "${KUBECONFIG}" == *".colima"* ]]; then
  say "=== Kubeconfig hygiene ==="
  echo "  Config: $KUBECONFIG (Colima — skipping overwrite to avoid breaking API server)"
  exit 0
fi
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
if [[ ! -s "$KUBECONFIG" ]] && [[ -s "$COLIMA_KUBE" ]]; then
  say "=== Kubeconfig hygiene ==="
  echo "  Colima config in use; not overwriting. To slim ~/.kube/config run: KUBECONFIG=~/.kube/config $0"
  exit 0
fi

say "=== Kubeconfig hygiene (remove unused contexts/clusters) ==="
echo "  Config: $KUBECONFIG"
echo ""

if [[ ! -s "$KUBECONFIG" ]]; then
  warn "No kubeconfig at $KUBECONFIG"
  exit 1
fi
# Safety: never overwrite Colima's kubeconfig (causes API server 'not ready' after hygiene).
if [[ "$KUBECONFIG" == *".colima"* ]]; then
  echo "  Skipping overwrite of Colima kubeconfig (would break API server)."
  exit 0
fi

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ -z "$ctx" ]]; then
  warn "No current context"
  exit 1
fi
echo "  Current context: $ctx"
# get-clusters prints a "NAME" header line; exclude it so we count actual clusters only
cluster_count=$(kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' | grep -c . || echo "0")
context_count=$(kubectl config get-contexts -o name 2>/dev/null | wc -l | tr -d ' ')
echo "  Contexts: $context_count  Clusters: $cluster_count"
echo ""

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "  (DRY_RUN: would replace config with minified — current context + cluster + user only)"
  kubectl config view --minify --raw 2>/dev/null | head -20
  echo "  ..."
  exit 0
fi

backup="$KUBECONFIG.bak.$(date +%Y%m%d-%H%M%S)"
cp -f "$KUBECONFIG" "$backup" && ok "Backed up to $backup"

minified=$(mktemp 2>/dev/null || echo "/tmp/kubeconfig-minified-$$.yaml")
kubectl config view --minify --raw > "$minified" 2>/dev/null || { rm -f "$minified"; warn "Failed to get minified config"; exit 1; }

cp -f "$minified" "$KUBECONFIG"
rm -f "$minified"
ok "Replaced with single-context config (context: $ctx)"
echo "  To restore: cp $backup $KUBECONFIG"
exit 0
