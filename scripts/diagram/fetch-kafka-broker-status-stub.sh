#!/usr/bin/env bash
# Stub: writes example kafka-broker-status.json. Replace with Prometheus/API logic for your stack.
# Usage: ./fetch-kafka-broker-status-stub.sh [out.json]
# Design notes: scripts/diagram/data/kafka-broker-status.prometheus-notes.md
set -euo pipefail

out="${1:-kafka-broker-status.json}"
cat >"$out" <<'JSON'
{
  "kb0": "stable",
  "kb1": "election_heavy",
  "kb2": "flapping"
}
JSON
echo "Wrote $out (example health values). Point KAFKA_BROKER_STATUS_JSON here and run make generate-diagrams."
