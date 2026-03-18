#!/usr/bin/env bash
# Ensure kubectl shim is in PATH for ALL scripts - guaranteed kubectl timeout fix

_SHIM_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIM_DIR="$_SHIM_SCRIPT_DIR/../shims"

# Always put shims first (see API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md)
export PATH="$SHIM_DIR:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# Verify kubectl shim is active (path contains shims)
kubectl_path="$(command -v kubectl 2>/dev/null)"
if [[ -n "$kubectl_path" && "$kubectl_path" == *"shims"* ]]; then
  return 0
fi
echo "⚠️  kubectl shim not active - timeout issues possible" >&2
return 1