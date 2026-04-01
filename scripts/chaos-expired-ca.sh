#!/usr/bin/env bash
# TLS CA chaos — **disabled by default**. Replacing cluster CA secrets breaks traffic until reissue.
#
# Dry-run (default): prints openssl + kubectl steps only.
# Live: CHAOS_TLS_CA_DESTROY=1 and either type DESTROY on stdin or CHAOS_TLS_TYPED_CONFIRM=DESTROY (CI / automation).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${CHAOS_ARTIFACT_DIR:-$REPO_ROOT/bench_logs/chaos-ca-$STAMP}"
mkdir -p "$ART"

if [[ "${CHAOS_TLS_CA_DESTROY:-0}" != "1" ]]; then
  say "DRY-RUN — chaos-expired-ca"
  cat <<'EOF' | tee "$ART/PLAN.txt"
To simulate CA mismatch you would:
1. Generate a throwaway CA (openssl).
2. Patch dev-root-ca or service-tls secrets (DANGEROUS).
3. Observe TLS handshake failures / gRPC UNAVAILABLE.
4. Restore: pnpm run reissue / dev-generate-certs / cluster reissue scripts.

This repo does NOT apply changes unless CHAOS_TLS_CA_DESTROY=1 and you type DESTROY (or set CHAOS_TLS_TYPED_CONFIRM=DESTROY).
EOF
  exit 0
fi

if [[ "${CHAOS_TLS_TYPED_CONFIRM:-}" == "DESTROY" ]]; then
  _ans="DESTROY"
else
  read -r -p "Type DESTROY to proceed with CA injection test: " _ans || true
fi
[[ "$_ans" == "DESTROY" ]] || { echo "Aborted."; exit 1; }

TMP="$ART/fake-ca"
mkdir -p "$TMP"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/fake.key" -out "$TMP/fake.pem" -days 1 \
  -subj "/CN=fake-chaos-ca" 2>&1 | tee "$ART/openssl.log"

say "Applying fake CA into dev-root-ca (ingress-nginx) — YOU MUST REVERT MANUALLY"
kubectl create secret generic dev-root-ca -n ingress-nginx \
  --from-file=dev-root.pem="$TMP/fake.pem" \
  --dry-run=client -o yaml | kubectl apply -f - 2>&1 | tee "$ART/kubectl-apply.log" || true

echo "Revert hint: re-run your normal CA sync / ./scripts/dev-generate-certs.sh + reissue path."
python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "fake CA injection" || true
