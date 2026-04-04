#!/usr/bin/env bash
# Full pod log dump for forensic analysis (raw tails, no grep).
# Output layout: $FORENSIC_LOG_ROOT/forensic/<ns>__<pod>__<container>.log
#
# Env:
#   FORENSIC_LOG_ROOT   — default: $PREFLIGHT_RUN_DIR or bench_logs/forensics/run-<stamp>
#   FORENSIC_NAMESPACES — space-separated (default: off-campus-housing-tracker ingress-nginx)
#   FORENSIC_LOG_TAIL   — default 500
#   FORENSIC_ALLOW_ALL_CONTAINERS — set to 1 to dump every container (default: all containers in pod)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" 2>/dev/null || true
_k() { kubectl --request-timeout=30s "$@"; }

TAIL="${FORENSIC_LOG_TAIL:-500}"
NS_LIST="${FORENSIC_NAMESPACES:-off-campus-housing-tracker ingress-nginx}"

if [[ -n "${PREFLIGHT_RUN_DIR:-}" ]]; then
  ROOT_DEFAULT="${PREFLIGHT_RUN_DIR}"
else
  ROOT_DEFAULT="$REPO_ROOT/bench_logs/forensics/run-$(date +%Y%m%d-%H%M%S)"
fi
ROOT="${FORENSIC_LOG_ROOT:-$ROOT_DEFAULT}"
OUT="$ROOT/forensic"
mkdir -p "$OUT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
warn() { echo "⚠️  $*" >&2; }

if ! command -v kubectl >/dev/null 2>&1 || ! _k get ns >/dev/null 2>&1; then
  warn "kubectl unavailable or cluster not reachable — wrote marker only."
  echo "kubectl_unavailable_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$OUT/SKIPPED.txt"
  echo "FORENSIC_LOG_ROOT=$ROOT"
  exit 0
fi

say "=== Forensic log sweep ==="
echo "FORENSIC_LOG_ROOT=$ROOT"
echo "tail_lines=$TAIL"
echo "namespaces=$NS_LIST"

for ns in $NS_LIST; do
  if ! _k get ns "$ns" >/dev/null 2>&1; then
    warn "namespace missing: $ns"
    continue
  fi
  pods=$(_k get pods -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
  for pod in $pods; do
    clist=$(_k get pod -n "$ns" "$pod" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null || true)
    [[ -z "$clist" ]] && clist="default"
    for ctr in $clist; do
      safe_ns="${ns//[^a-zA-Z0-9._-]/_}"
      safe_pod="${pod//[^a-zA-Z0-9._-]/_}"
      safe_ctr="${ctr//[^a-zA-Z0-9._-]/_}"
      dest="$OUT/${safe_ns}__${safe_pod}__${safe_ctr}.log"
      {
        echo "=== $ns/$pod container=$ctr tail=$TAIL ==="
        _k logs -n "$ns" "$pod" -c "$ctr" --tail="$TAIL" 2>&1 || echo "(logs unavailable)"
      } >"$dest"
      echo "Wrote $dest"
    done
  done
done

echo ""
echo "Done. Index: ls -la \"$OUT\""
