#!/usr/bin/env bash
# Load infra/required_images.json into Colima VM Docker when missing (docker save | colima ssh docker load).
# Requires images on host Docker first (build P6 / manual docker build).
# Env: REPO_ROOT, VERIFY_REQUIRED_IMAGES_JSON — overrides.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
JSON="${VERIFY_REQUIRED_IMAGES_JSON:-$ROOT/infra/required_images.json}"

if ! colima status 2>/dev/null | grep -qiE 'colima is running|running'; then
  echo "ℹ️  Colima not running — skipping required-image load"
  exit 0
fi

while IFS= read -r img; do
  [[ -z "$img" ]] && continue
  if colima ssh -- docker image inspect "$img" >/dev/null 2>&1; then
    echo "✅ $img already in Colima VM Docker"
    continue
  fi
  echo "  ▶ loading $img into Colima VM Docker…"
  if docker image inspect "$img" >/dev/null 2>&1; then
    docker save "$img" | colima ssh -- docker load
  else
    echo "❌ host Docker does not have $img — build it first (e.g. docker build -t $img . or P6 services)" >&2
    exit 1
  fi
done < <(python3 <<PY
import json
with open("$JSON", encoding="utf-8") as fh:
    d = json.load(fh)
for im in d.get("images") or []:
    if isinstance(im, str) and im.strip():
        print(im.strip())
PY
)

echo "✅ required images present in Colima VM Docker"
