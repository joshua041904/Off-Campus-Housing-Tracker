#!/usr/bin/env bash
# Shared gRPC + HTTP/3 health checks: Envoy (plaintext), Envoy (strict TLS / mTLS), port-forward (strict TLS / mTLS), Caddy HTTP/3.
# Source this and call run_grpc_http3_health_checks. Expects: CA_CERT, NS, HOST, PORT, HTTP3_RESOLVE (or set HOST/PORT).
# When TARGET_IP is set (e.g. MetalLB IP from run-all-test-suites.sh): HTTP/3 and gRPC health use LB IP:PORT (primary path).
# Optional: GRPC_CERTS_DIR (or /tmp/grpc-certs) with tls.crt + tls.key for mTLS; strict_http3_curl, _kb (fallback: kubectl). say/ok/warn/info must be defined by caller (info fallback below).
# On Colima: gRPC Envoy (plaintext) often not OK (NodePort not exposed to host). Port-forward: use host kubectl
# so 127.0.0.1:50051 is on host — set KUBECTL_PORT_FORWARD="kubectl --request-timeout=15s" when using _kb=colima ssh.

run_grpc_http3_health_checks() {
  export GRPC_HTTP3_HEALTH_OK=1
  type _kb &>/dev/null || _kb() { kubectl --request-timeout=10s "$@" 2>/dev/null || true; }
  type info &>/dev/null || info() { echo "ℹ️  $*"; }
  local lib_dir="${BASH_SOURCE[0]%/*}"
  local script_dir="${SCRIPT_DIR:-$lib_dir/..}"
  [[ -d "$script_dir" ]] || script_dir="$(cd "$lib_dir/.." && pwd)"
  local ns="${NS:-off-campus-housing-tracker}"
  local host="${HOST:-off-campus-housing.local}"
  local port="${PORT:-30443}"
  # Prefer MetalLB IP when TARGET_IP is set (run-all-test-suites.sh exports it with PORT=443)
  local http3_resolve
  if [[ -n "${TARGET_IP:-}" ]] && [[ "${port}" == "443" ]]; then
    port=443
    http3_resolve="${host}:443:${TARGET_IP}"
  else
    http3_resolve="${HTTP3_RESOLVE:-${host}:${port}:127.0.0.1}"
  fi
  local proto_dir=""
  [[ -d "$script_dir/../proto" ]] && proto_dir="$(cd "$script_dir/../proto" && pwd)"
  [[ -z "$proto_dir" ]] && [[ -d "$script_dir/../infra/k8s/base/config/proto" ]] && proto_dir="$(cd "$script_dir/../infra/k8s/base/config/proto" && pwd)"

  # Caddy HTTP/3 health (strict TLS when CA_CERT set). URL must use port when not 443 so host→NodePort works.
  local h3_url="https://${host}:${port}/_caddy/healthz"
  [[ "$port" == "443" ]] && h3_url="https://${host}/_caddy/healthz"
  say "Health: Caddy HTTP/3 (strict TLS with explicit QUIC verification)"
  info "  Target: $h3_url (resolve: $http3_resolve)"
  info "  Using: $(type strict_http3_curl &>/dev/null && echo "strict_http3_curl (with CA)" || echo "http3_curl (insecure)")"
  
  local h3_out h3_rc=0
  if type strict_http3_curl &>/dev/null; then
    h3_out=$(strict_http3_curl -sS -w "\n%{http_code}\n%{http_version}" --http3-only --max-time 10 \
      -H "Host: $host" --resolve "$http3_resolve" \
      "$h3_url" 2>&1) || h3_rc=$?
  else
    h3_out=$(http3_curl -k -sS -w "\n%{http_code}\n%{http_version}" --http3-only --max-time 10 \
      -H "Host: $host" --resolve "$http3_resolve" \
      "$h3_url" 2>&1) || h3_rc=$?
  fi
  
  local h3_code=$(echo "$h3_out" | tail -2 | head -1)
  local h3_version=$(echo "$h3_out" | tail -1)
  
  info "  HTTP Code: ${h3_code:-none}, Version: ${h3_version:-none}, curl exit: $h3_rc"
  
  if [[ "$h3_code" == "200" ]]; then
    ok "Caddy HTTP/3 health: OK (HTTP $h3_code, version: $h3_version)"
  else
    warn "Caddy HTTP/3 health: failed (HTTP ${h3_code:-none}, curl exit $h3_rc)"
    if [[ $h3_rc -eq 77 ]]; then
      warn "  curl exit 77 = CA certificate problem (strict TLS verification failed)"
    elif [[ $h3_rc -eq 28 ]]; then
      warn "  curl exit 28 = timeout (QUIC handshake may have failed)"
    elif [[ $h3_rc -eq 7 ]]; then
      warn "  curl exit 7 = connection refused (UDP/port may not be reachable)"
    elif [[ $h3_rc -eq 6 ]]; then
      warn "  curl exit 6 = couldn't resolve host (use PORT in URL and HTTP3_RESOLVE, e.g. off-campus-housing.local:30443:127.0.0.1)"
    fi
    echo "$h3_out" | head -5
    GRPC_HTTP3_HEALTH_OK=0
  fi

  # gRPC: When TARGET_IP + PORT=443 (MetalLB), only test via LB IP — real production path. Skip NodePort/port-forward.
  if [[ -z "$proto_dir" ]] || [[ ! -d "$proto_dir" ]] || ! command -v grpcurl >/dev/null 2>&1; then
    warn "gRPC health skipped (proto dir or grpcurl missing)"
    return 0
  fi

  local metalb_only=0
  [[ -n "${TARGET_IP:-}" ]] && [[ "${port:-443}" == "443" ]] && metalb_only=1
  [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]] && metalb_only=1

  if [[ $metalb_only -eq 0 ]]; then
    say "Health: gRPC via Envoy (plaintext)"
    local grpc_ok=0
    for p in 30000 30001; do
      local out
      out=$(grpcurl -plaintext -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 3 -d '{"service":""}' "127.0.0.1:$p" grpc.health.v1.Health/Check 2>&1) || true
      if echo "$out" | grep -q "SERVING"; then
        ok "gRPC Envoy (plaintext) port $p: OK"
        grpc_ok=1
        break
      fi
    done
    [[ $grpc_ok -eq 0 ]] && warn "gRPC Envoy (plaintext): not OK (expected on Colima - NodePort not exposed to host; strict TLS/mTLS is the primary path)"
  fi

  say "Health: gRPC via Envoy (strict TLS / mTLS)"
  local grpc_ok=0
  grpc_certs_dir="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
  use_mtls=0
  if [[ -f "${grpc_certs_dir}/tls.crt" ]] && [[ -f "${grpc_certs_dir}/tls.key" ]]; then
    use_mtls=1
  fi
  ca_file="${CA_CERT:-}"
  [[ -z "$ca_file" ]] && [[ -f "$grpc_certs_dir/ca.crt" ]] && ca_file="$grpc_certs_dir/ca.crt"
  # MetalLB: grpcurl dials IP — trust anchor must match Caddy leaf chain (cluster secret or repo dev-root.pem)
  if [[ -z "$ca_file" ]] || [[ ! -f "$ca_file" ]] || [[ ! -s "$ca_file" ]]; then
    [[ -f "$script_dir/../certs/dev-root.pem" ]] && ca_file="$(cd "$script_dir/.." && pwd)/certs/dev-root.pem"
  fi
  grpc_authority="${HOST:-off-campus-housing.local}"
  if [[ -n "$ca_file" ]] && [[ -f "$ca_file" ]]; then
    # MetalLB / LB IP: primary path when TARGET_IP + PORT=443
    if [[ -n "${TARGET_IP:-}" ]] && [[ "${port:-443}" == "443" ]]; then
      if [[ $use_mtls -eq 1 ]]; then
        out=$(grpcurl -cacert "$ca_file" -cert "$grpc_certs_dir/tls.crt" -key "$grpc_certs_dir/tls.key" -authority "$grpc_authority" -servername "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || true
      else
        out=$(grpcurl -cacert "$ca_file" -authority "$grpc_authority" -servername "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || true
      fi
      if echo "$out" | grep -q "SERVING"; then
        [[ $use_mtls -eq 1 ]] && ok "gRPC via MetalLB IP (mTLS): OK" || ok "gRPC via MetalLB IP (strict TLS): OK"
        grpc_ok=1
      fi
    fi
    # When metalb_only: skip NodePort and port-forward fallbacks — LB IP is the only path
    if [[ $metalb_only -eq 1 ]] && [[ $grpc_ok -eq 1 ]]; then
      :  # LB path succeeded; nothing more to do
    elif [[ $metalb_only -eq 1 ]] && [[ $grpc_ok -eq 0 ]]; then
      warn "gRPC via LB IP: not OK (check CA matches Caddy chain, ${TARGET_IP}:443 reachability, -authority/-servername=${grpc_authority})"
      GRPC_HTTP3_HEALTH_OK=0
    else
    # Envoy NodePort (127.0.0.1:30000/30001) when LB path not used or not OK
    if [[ $grpc_ok -eq 0 ]]; then
    for p in 30000 30001; do
      if [[ $use_mtls -eq 1 ]]; then
        out=$(grpcurl -cacert "$ca_file" -cert "$grpc_certs_dir/tls.crt" -key "$grpc_certs_dir/tls.key" -authority "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "127.0.0.1:$p" grpc.health.v1.Health/Check 2>&1) || true
      else
        out=$(grpcurl -cacert "$ca_file" -authority "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "127.0.0.1:$p" grpc.health.v1.Health/Check 2>&1) || true
      fi
      if echo "$out" | grep -q "SERVING"; then
        [[ $use_mtls -eq 1 ]] && ok "gRPC Envoy (mTLS) port $p: OK" || ok "gRPC Envoy (strict TLS) port $p: OK"
        grpc_ok=1
        break
      fi
    done
    fi
    # When NodePort (30000/30001) not on host: try host port-forward to Envoy pod (container 10000). Works when KUBECTL_PORT_FORWARD runs on host (e.g. kubeconfig via 127.0.0.1:6443).
    if [[ $grpc_ok -eq 0 ]]; then
      local envoy_pod envoy_ns
      envoy_pod=$(_kb -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
      envoy_ns="envoy-test"
      [[ -z "$envoy_pod" ]] && { envoy_pod=$(_kb -n ingress-nginx get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo ""); envoy_ns="ingress-nginx"; }
      if [[ -n "$envoy_pod" ]] && [[ -n "$ca_file" ]]; then
        local pf_cmd="${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s}"
        $pf_cmd -n "$envoy_ns" port-forward "pod/$envoy_pod" 10000:10000 >/dev/null 2>&1 &
        local env_pf_pid=$!
        sleep 3
        if [[ $use_mtls -eq 1 ]]; then
          out=$(grpcurl -cacert "$ca_file" -cert "$grpc_certs_dir/tls.crt" -key "$grpc_certs_dir/tls.key" -authority "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 4 -d '{"service":""}' "127.0.0.1:10000" grpc.health.v1.Health/Check 2>&1) || true
        else
          out=$(grpcurl -cacert "$ca_file" -authority "$grpc_authority" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 4 -d '{"service":""}' "127.0.0.1:10000" grpc.health.v1.Health/Check 2>&1) || true
        fi
        kill $env_pf_pid 2>/dev/null || true
        wait $env_pf_pid 2>/dev/null || true
        if echo "$out" | grep -q "SERVING"; then
          ok "gRPC Envoy (strict TLS/mTLS) via port-forward 10000: OK"
          grpc_ok=1
        fi
      fi
    fi
    fi  # end metalb_only else (NodePort + Envoy port-forward fallbacks)
  fi
  [[ $metalb_only -eq 0 ]] && [[ $grpc_ok -eq 0 ]] && { warn "gRPC Envoy (strict TLS/mTLS): not OK (or CA_CERT missing; on Colima NodePort not on host - see TEST-FAILURES-AND-WARNINGS.md)"; GRPC_HTTP3_HEALTH_OK=0; }

  if [[ $metalb_only -eq 0 ]]; then
  say "Health: gRPC via port-forward (strict TLS / mTLS)"
  local auth_pod
  auth_pod=$(_kb -n "$ns" get pods -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  ca_file="${CA_CERT:-}"
  [[ -z "$ca_file" ]] && [[ -f "$grpc_certs_dir/ca.crt" ]] && ca_file="$grpc_certs_dir/ca.crt"
  if [[ -n "$auth_pod" ]] && [[ -n "$ca_file" ]] && [[ -f "$ca_file" ]]; then
    local pf_ok=0
    # On Colima, host kubectl often cannot reach 127.0.0.1:6443; run port-forward + grpcurl inside VM (copy CA into VM)
    local ctx="${KUBECTL_CONTEXT:-}"
    [[ -z "$ctx" ]] && ctx=$(kubectl config current-context 2>/dev/null || echo "")
    if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      cat "$ca_file" | colima ssh -- sh -c "cat > /tmp/grpc-pf-ca.pem" 2>/dev/null || true
      # Timeout 16s so we never hang (Colima VM: longer sleep + retries for port-forward)
      local pf_out
      pf_out=$(mktemp 2>/dev/null || echo "/tmp/grpc-pf-out-$$.tmp")
      ( colima ssh -- bash -c "kubectl -n $ns port-forward pod/$auth_pod 50051:50051 --request-timeout=15s & PF=\$!; sleep 6; out=\$(grpcurl -cacert /tmp/grpc-pf-ca.pem -max-time 4 -d '{\"service\":\"\"}' 127.0.0.1:50051 grpc.health.v1.Health/Check 2>\&1); echo \"\$out\" | grep -q SERVING || { sleep 2; out=\$(grpcurl -cacert /tmp/grpc-pf-ca.pem -max-time 4 -d '{\"service\":\"\"}' 127.0.0.1:50051 grpc.health.v1.Health/Check 2>\&1); }; kill \$PF 2>/dev/null; wait \$PF 2>/dev/null; echo \"\$out\"" > "$pf_out" 2>&1 ) &
      local pf_pid=$!
      local waited=0
      while [[ $waited -lt 16 ]] && kill -0 "$pf_pid" 2>/dev/null; do sleep 1; waited=$((waited + 1)); done
      kill "$pf_pid" 2>/dev/null || true
      wait "$pf_pid" 2>/dev/null || true
      out=$(cat "$pf_out" 2>/dev/null || true)
      rm -f "$pf_out" 2>/dev/null || true
      if echo "$out" | grep -q "SERVING"; then
        ok "gRPC port-forward (strict TLS): OK (Colima VM)"
        pf_ok=1
      fi
    fi
    if [[ $pf_ok -eq 0 ]]; then
      local pf_cmd="${KUBECTL_PORT_FORWARD:-kubectl --request-timeout=15s}"
      $pf_cmd -n "$ns" port-forward "pod/$auth_pod" 50051:50051 >/dev/null 2>&1 &
      local pf_pid=$!
      local pf_retries=0
      while [[ $pf_retries -lt 10 ]]; do
        sleep 1
        (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 50051 2>/dev/null) || (command -v lsof >/dev/null 2>&1 && lsof -i :50051 >/dev/null 2>&1) && break
        pf_retries=$((pf_retries + 1))
      done
      if [[ $use_mtls -eq 1 ]]; then
        out=$(grpcurl -cacert "$ca_file" -cert "$grpc_certs_dir/tls.crt" -key "$grpc_certs_dir/tls.key" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "127.0.0.1:50051" grpc.health.v1.Health/Check 2>&1) || true
      else
        out=$(grpcurl -cacert "$ca_file" -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 5 -d '{"service":""}' "127.0.0.1:50051" grpc.health.v1.Health/Check 2>&1) || true
      fi
      kill $pf_pid 2>/dev/null || true
      wait $pf_pid 2>/dev/null || true
      if echo "$out" | grep -q "SERVING"; then
        [[ $use_mtls -eq 1 ]] && ok "gRPC port-forward (mTLS): OK" || ok "gRPC port-forward (strict TLS): OK"
        pf_ok=1
      fi
    fi
    if [[ $pf_ok -eq 0 ]]; then
      warn "gRPC port-forward (strict TLS/mTLS): not OK"
      GRPC_HTTP3_HEALTH_OK=0
    fi
  else
    warn "gRPC port-forward skipped (auth pod or CA_CERT missing)"
    GRPC_HTTP3_HEALTH_OK=0
  fi
  fi  # end metalb_only: skip port-forward block when using LB IP only
  export GRPC_HTTP3_HEALTH_OK
}
