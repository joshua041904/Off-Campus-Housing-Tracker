#!/usr/bin/env bash
# Strict TLS/mTLS preflight: validate service-tls + dev-root-ca; provision from repo or mkcert if missing; sync CA to certs/dev-root.pem; optionally rollout restart gRPC/TLS workloads.
# Used by run-preflight-scale-and-all-suites.sh (step 5) and run-all-test-suites.sh (with FORCE_TLS_RESTART=1 for standalone).
# See Runbook §24–25.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS="${NS:-off-campus-housing-tracker}"
NS_ING="${NS_ING:-ingress-nginx}"
CERTS_DIR="${REPO_ROOT}/certs"
SECRET_UPDATED=0

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; exit 1; }

# --- 1. Validate service-tls + dev-root-ca in cluster ---
_validate_secrets() {
  local need_provision=0
  if ! kubectl -n "$NS" get secret service-tls -o name &>/dev/null; then
    warn "service-tls missing in $NS"
    need_provision=1
  fi
  if ! kubectl -n "$NS" get secret dev-root-ca -o name &>/dev/null; then
    warn "dev-root-ca missing in $NS"
    need_provision=1
  fi
  if [[ $need_provision -eq 1 ]]; then
    echo 1
    return
  fi

  local tmpd
  tmpd=$(mktemp -d 2>/dev/null || echo "/tmp/grpc-validate-$$")
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -d > "$tmpd/ca.crt" 2>/dev/null || true
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d > "$tmpd/tls.crt" 2>/dev/null || true
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d > "$tmpd/tls.key" 2>/dev/null || true
  kubectl -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$tmpd/dev-root.pem" 2>/dev/null || true

  if [[ ! -s "$tmpd/ca.crt" ]] || [[ ! -s "$tmpd/tls.crt" ]] || [[ ! -s "$tmpd/tls.key" ]]; then
    warn "service-tls incomplete (ca.crt/tls.crt/tls.key)"
    rm -rf "$tmpd"
    echo 1
    return
  fi
  if [[ ! -s "$tmpd/dev-root.pem" ]]; then
    warn "dev-root-ca empty or missing"
    rm -rf "$tmpd"
    echo 1
    return
  fi

  if ! openssl verify -CAfile "$tmpd/ca.crt" "$tmpd/tls.crt" &>/dev/null; then
    warn "openssl verify failed (leaf not signed by CA)"
    rm -rf "$tmpd"
    echo 1
    return
  fi
  local key_mod cert_mod
  key_mod=$(openssl rsa -noout -modulus -in "$tmpd/tls.key" 2>/dev/null | openssl md5)
  cert_mod=$(openssl x509 -noout -modulus -in "$tmpd/tls.crt" 2>/dev/null | openssl md5)
  if [[ "$key_mod" != "$cert_mod" ]]; then
    warn "service-tls key/cert modulus mismatch"
    rm -rf "$tmpd"
    echo 1
    return
  fi
  rm -rf "$tmpd"
  echo 0
}

# --- 2. Provision from repo certs or mkcert ---
_provision_from_repo() {
  if [[ -f "$CERTS_DIR/dev-root.pem" ]] && [[ -f "$CERTS_DIR/off-campus-housing.local.crt" ]] && [[ -f "$CERTS_DIR/off-campus-housing.local.key" ]]; then
    mkdir -p "$CERTS_DIR"
    kubectl -n "$NS" create secret generic service-tls \
      --from-file=ca.crt="$CERTS_DIR/dev-root.pem" \
      --from-file=tls.crt="$CERTS_DIR/off-campus-housing.local.crt" \
      --from-file=tls.key="$CERTS_DIR/off-campus-housing.local.key" \
      --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n "$NS_ING" create secret generic dev-root-ca --from-file=dev-root.pem="$CERTS_DIR/dev-root.pem" --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n "$NS" create secret generic dev-root-ca --from-file=dev-root.pem="$CERTS_DIR/dev-root.pem" --dry-run=client -o yaml | kubectl apply -f -
    ok "Provisioned service-tls + dev-root-ca from repo certs"
    return 0
  fi
  return 1
}

_provision_from_mkcert() {
  local caroot
  caroot=$(mkcert -CAROOT 2>/dev/null)
  if [[ -z "$caroot" ]] || [[ ! -f "$caroot/rootCA.pem" ]]; then
    return 1
  fi
  local tmpd
  tmpd=$(mktemp -d 2>/dev/null || echo "/tmp/mkcert-provision-$$")
  mkcert -cert-file "$tmpd/tls.crt" -key-file "$tmpd/tls.key" \
    off-campus-housing.local "*.off-campus-housing.local" localhost 127.0.0.1 \
    "auth-service.off-campus-housing-tracker.svc.cluster.local" \
    "api-gateway.off-campus-housing-tracker.svc.cluster.local" \
    "listings-service.off-campus-housing-tracker.svc.cluster.local" \
    "booking-service.off-campus-housing-tracker.svc.cluster.local" \
    "messaging-service.off-campus-housing-tracker.svc.cluster.local" \
    "trust-service.off-campus-housing-tracker.svc.cluster.local" \
    "analytics-service.off-campus-housing-tracker.svc.cluster.local" \
    "*.off-campus-housing-tracker.svc.cluster.local" \
    &>/dev/null || true
  if [[ ! -f "$tmpd/tls.crt" ]] || [[ ! -f "$tmpd/tls.key" ]]; then
    rm -rf "$tmpd"
    return 1
  fi
  cp "$caroot/rootCA.pem" "$tmpd/ca.crt"
  kubectl -n "$NS" create secret generic service-tls \
    --from-file=ca.crt="$tmpd/ca.crt" \
    --from-file=tls.crt="$tmpd/tls.crt" \
    --from-file=tls.key="$tmpd/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "$NS_ING" create secret generic dev-root-ca --from-file=dev-root.pem="$tmpd/ca.crt" --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "$NS" create secret generic dev-root-ca --from-file=dev-root.pem="$tmpd/ca.crt" --dry-run=client -o yaml | kubectl apply -f -
  mkdir -p "$CERTS_DIR"
  cp -f "$tmpd/ca.crt" "$CERTS_DIR/dev-root.pem"
  cp -f "$tmpd/tls.crt" "$CERTS_DIR/off-campus-housing.local.crt"
  cp -f "$tmpd/tls.key" "$CERTS_DIR/off-campus-housing.local.key"
  ok "Provisioned service-tls + dev-root-ca from mkcert"
  rm -rf "$tmpd"
  return 0
}

# --- 3. Sync certs/dev-root.pem from cluster (single source for k6) ---
_sync_ca_to_repo() {
  local ca
  ca=$(kubectl -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || true)
  if [[ -n "$ca" ]]; then
    mkdir -p "$CERTS_DIR"
    echo "$ca" > "$CERTS_DIR/dev-root.pem"
    ok "Synced certs/dev-root.pem from cluster"
  else
    warn "Could not sync dev-root.pem from cluster"
  fi
}

# --- Main ---
say "Strict TLS/mTLS preflight (service-tls + dev-root-ca)"

need=$(_validate_secrets)
if [[ "$need" == "1" ]]; then
  if _provision_from_repo; then
    SECRET_UPDATED=1
  elif _provision_from_mkcert; then
    SECRET_UPDATED=1
  else
    fail "Cannot provision: ensure certs/dev-root.pem, certs/off-campus-housing.local.crt, certs/off-campus-housing.local.key exist, or install mkcert (brew install mkcert && mkcert -install). Then re-run or run pnpm run reissue."
  fi
else
  ok "service-tls + dev-root-ca validated"
fi

_sync_ca_to_repo

# Envoy client cert must be signed by the same CA as dev-root-ca. After reissue (step 3a), the CA
# changes but envoy-client-tls is never updated → Envoy presents stale client cert → backends reject.
# Regenerate envoy-client.crt and update envoy-client-tls whenever we have the CA key.
_ensure_envoy_client_cert_aligned() {
  local ca_crt="" ca_key=""
  if [[ -f "$CERTS_DIR/dev-root.pem" ]] && [[ -f "$CERTS_DIR/dev-root.key" ]]; then
    ca_crt="$CERTS_DIR/dev-root.pem"
    ca_key="$CERTS_DIR/dev-root.key"
  else
    local caroot
    caroot=$(mkcert -CAROOT 2>/dev/null)
    if [[ -n "$caroot" ]] && [[ -f "$caroot/rootCA.pem" ]] && [[ -f "$caroot/rootCA-key.pem" ]]; then
      # Cluster may use mkcert CA (from _provision_from_mkcert); verify before using
      local cluster_ca cluster_subj mkcert_subj
      cluster_ca=$(kubectl -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || true)
      cluster_subj=$(echo "$cluster_ca" | openssl x509 -noout -subject 2>/dev/null || true)
      mkcert_subj=$(openssl x509 -in "$caroot/rootCA.pem" -noout -subject 2>/dev/null || true)
      if [[ -n "$cluster_subj" ]] && [[ "$cluster_subj" == "$mkcert_subj" ]]; then
        ca_crt="$caroot/rootCA.pem"
        ca_key="$caroot/rootCA-key.pem"
      fi
    fi
  fi
  if [[ -z "$ca_crt" ]] || [[ -z "$ca_key" ]]; then
    return 0
  fi
  # Verify current envoy-client-tls against cluster CA; if invalid, regenerate
  local envoy_crt need_regen=0
  envoy_crt=$(kubectl -n envoy-test get secret envoy-client-tls -o jsonpath='{.data.envoy\.crt}' 2>/dev/null | base64 -d 2>/dev/null || true)
  if [[ -n "$envoy_crt" ]]; then
    local cluster_ca tmpd
    cluster_ca=$(kubectl -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || true)
    if [[ -n "$cluster_ca" ]]; then
      tmpd=$(mktemp -d 2>/dev/null || echo "/tmp/envoy-verify-$$")
      echo "$cluster_ca" > "$tmpd/ca.pem"
      echo "$envoy_crt" > "$tmpd/envoy.crt"
      if ! openssl verify -CAfile "$tmpd/ca.pem" "$tmpd/envoy.crt" &>/dev/null; then
        need_regen=1
      fi
      rm -rf "$tmpd"
    fi
  else
    need_regen=1
  fi
  if [[ $need_regen -eq 1 ]]; then
    CA_CRT="$ca_crt" CA_KEY="$ca_key" "$SCRIPT_DIR/generate-envoy-client-cert.sh" &>/dev/null || return 0
    kubectl -n envoy-test delete secret envoy-client-tls --ignore-not-found &>/dev/null || true
    kubectl -n envoy-test create secret generic envoy-client-tls \
      --from-file=envoy.crt="$CERTS_DIR/envoy-client.crt" \
      --from-file=envoy.key="$CERTS_DIR/envoy-client.key" &>/dev/null && ok "envoy-client-tls aligned with dev-root-ca" || true
  fi
}

# Envoy (envoy-test) uses dev-root-ca for upstream TLS verification and envoy-client-tls for client cert.
# After reissue, the CA changes; envoy-client-tls must be regenerated or Envoy→backend mTLS fails.
say "Ensuring Envoy client cert aligned with dev-root-ca"
_ensure_envoy_client_cert_aligned

# Sync dev-root-ca (and envoy-service-tls) to envoy-test; Envoy uses CA to verify backend server certs.
if [[ -f "$SCRIPT_DIR/sync-envoy-tls-secrets.sh" ]]; then
  say "Syncing dev-root-ca to envoy-test (Envoy upstream TLS verification)"
  "$SCRIPT_DIR/sync-envoy-tls-secrets.sh" 2>/dev/null && ok "envoy-test secrets synced" || warn "sync-envoy-tls-secrets had issues"
  kubectl -n envoy-test rollout restart deploy/envoy-test --request-timeout=15s 2>/dev/null && ok "Restarted envoy-test" || true
  kubectl -n envoy-test rollout status deploy/envoy-test --timeout=90s 2>/dev/null || true
fi

if [[ "${FORCE_TLS_RESTART:-0}" == "1" ]] || [[ $SECRET_UPDATED -eq 1 ]]; then
  say "Rollout restart (FORCE_TLS_RESTART=$FORCE_TLS_RESTART, SECRET_UPDATED=$SECRET_UPDATED)"
  for dep in api-gateway auth-service listings-service booking-service messaging-service trust-service analytics-service; do
    kubectl -n "$NS" rollout restart "deploy/$dep" --request-timeout=15s 2>/dev/null && ok "Restarted $dep" || warn "Restart $dep failed"
  done
  kubectl -n "$NS_ING" rollout restart deploy/caddy-h3 --request-timeout=15s 2>/dev/null && ok "Restarted caddy-h3" || warn "Restart caddy-h3 failed"
fi

say "Strict TLS/mTLS preflight complete"
