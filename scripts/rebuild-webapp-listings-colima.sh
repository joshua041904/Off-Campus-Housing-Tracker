#!/usr/bin/env bash
# Backward-compat wrapper. Use rebuild-housing-colima.sh instead.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "⚠️  Deprecated: use ./scripts/rebuild-housing-colima.sh"
exec "$SCRIPT_DIR/rebuild-housing-colima.sh" "$@"
