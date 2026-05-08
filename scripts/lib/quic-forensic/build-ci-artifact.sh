#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCAP="${1:-}"
KEYLOG="${2:-}"

if [[ -z "$PCAP" ]]; then
  echo '{"valid":false,"error":"pcap path required"}'
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"valid":false,"error":"jq not installed"}'
  exit 2
fi

analyzer="${QUIC_FORENSIC_ANALYZER:-$SCRIPT_DIR/analyze-quic-v6.sh}"
if [[ ! -x "$analyzer" ]]; then
  analyzer="$SCRIPT_DIR/analyze-quic-v5.sh"
fi
if [[ ! -x "$analyzer" ]]; then
  analyzer="$SCRIPT_DIR/analyze-quic.sh"
fi

if ! result="$("$analyzer" "$PCAP" "$KEYLOG" 2>&1)"; then
  status=$?
  [[ -n "$result" ]] && echo "$result"
  exit $status
fi

echo "$result" | jq \
  --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '. + {
    ci_metadata: {
      generated_at: $timestamp,
      transport_invariant_version: "v6",
      forensic_mode: "quic-json-analysis"
    }
  }'
