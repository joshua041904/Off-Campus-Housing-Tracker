#!/usr/bin/env bash
# Print TLS certificate expiry for selected TLS secrets (Prometheus textfile friendly).
# Usage:
#   ./scripts/tls-k8s-secrets-expiry.sh > /var/lib/node_exporter/textfile/tls_expiry.prom
# Env:
#   TLS_EXPIRY_NAMESPACES="off-campus-housing-tracker ingress-nginx"
#   TLS_EXPIRY_SECRET_SELECTOR=""  # optional grep filter on secret name
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

NS_LIST="${TLS_EXPIRY_NAMESPACES:-off-campus-housing-tracker ingress-nginx}"
EPOCH=$(date +%s)

emit() {
  local ns="$1" sec="$2" days="$3"
  echo "och_tls_cert_days_remaining{namespace=\"$ns\",secret=\"$sec\"} $days"
}

for ns in $NS_LIST; do
  secrets=$(kubectl get secret -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
  for sec in $secrets; do
    [[ -n "${TLS_EXPIRY_SECRET_SELECTOR:-}" ]] && [[ ! "$sec" =~ $TLS_EXPIRY_SECRET_SELECTOR ]] && continue
    data=$(kubectl get secret "$sec" -n "$ns" -o jsonpath='{.data.tls\.crt}' 2>/dev/null || true)
    [[ -z "$data" ]] && continue
    pem=$(echo "$data" | base64 -d 2>/dev/null || true)
    [[ -z "$pem" ]] && continue
    end=$(echo "$pem" | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//') || continue
    end_epoch=$(date -d "$end" +%s 2>/dev/null || date -j -f "%b %e %T %Y %Z" "$end" +%s 2>/dev/null || echo 0)
    [[ "$end_epoch" -eq 0 ]] && continue
    days=$(( (end_epoch - EPOCH) / 86400 ))
    emit "$ns" "$sec" "$days"
  done
done
