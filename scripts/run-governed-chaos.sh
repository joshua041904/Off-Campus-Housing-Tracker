#!/usr/bin/env bash
# Run chaos suite then SLO budget sample + optional resilience score file.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

bash "$SCRIPT_DIR/run-chaos-suite.sh"

ART=$(ls -td "$REPO_ROOT"/bench_logs/chaos-suite-* 2>/dev/null | head -1 || true)
[[ -n "$ART" ]] || exit 0

# Example budget calc (placeholder availability)
python3 "$SCRIPT_DIR/calc-failure-budget.py" --availability 0.9992 --target 0.999 2>/dev/null | tee "$ART/failure-budget.json" || true

# Resilience score stub (deterministic template)
python3 - <<'PY' | tee "$ART/resilience-score.json"
import json
print(json.dumps({
  "resilience_score": 82,
  "grade": "B+",
  "notes": [
    "Stub score — wire Prometheus SLI + MTTR from chaos artifacts",
    "HPA: api-gateway has CPU requests in base; if ScalingActive fails, fix metrics-server / metrics.k8s.io",
  ],
}, indent=2))
PY

python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "governed chaos (re-run)" --out "$ART/chaos-report-governed.md" || true
echo "Governed artifacts under: $ART"
