#!/usr/bin/env bash

# Shared helpers for issuing HTTP/3 (QUIC) requests. Paths (in order of use):
#   1. Native curl + MetalLB LB IP (HTTP3_USE_NATIVE_CURL=1): host curl → LB IP:443 → socat → NodePort 30443 → Caddy.
#   2. Docker + host network + Docker bridge (HTTP3_DOCKER_FORWARD_PORT=18443): container curl → 127.0.0.1:18443 → host socat → NodePort → Caddy.
#   3. NodePort fallback (HTTP3_USE_LB_IP=0): resolve off-campus-housing.local to 127.0.0.1:30443.
#
# MetalLB + k3d on macOS: The baseline sets HTTP3_USE_NATIVE_CURL=1 when TARGET_IP
# (LB IP) and PORT=443 are set. Host curl then hits LB IP:443; socat (started by
# setup-lb-ip-host-access.sh) forwards UDP 443 to 127.0.0.1:NodePort. If socat is not bound (e.g. "Address already in use"), run:
#   sudo LB_IP=<LB_IP> NODEPORT=30443 ./scripts/setup-lb-ip-host-access.sh
# then re-run the suite or diagnostic. See docs/HTTP3-CURL-EXIT-CODES.md and
# scripts/diagnose-http3-lb-ip-under-the-hood.sh.
#
# When native curl to LB IP fails (host↔NodePort UDP limit on macOS):
# The baseline sets HTTP3_USE_NATIVE_CURL=0 and HTTP3_DOCKER_FORWARD_PORT=18443 so
# http3_curl uses a container (--network host) hitting 127.0.0.1:18443 (Docker bridge socat). To force that path:
#   HTTP3_USE_NATIVE_CURL=0 HTTP3_DOCKER_FORWARD_PORT=18443
# To skip the Docker bridge and use only native curl to LB IP:
#   HTTP3_SKIP_DOCKER_BRIDGE=1
#
# By default, runner setup failures (Docker/node/image) are reported and return 1
# so the process does not exit; set HTTP3_STRICT=1 to restore legacy exit behaviour.

# When HTTP3_STRICT=1, we call the caller's fail() or exit 1 so the process stops (legacy).
# Otherwise we only warn and return 1 so callers can continue and "make it all the way"
# (e.g. HTTP/3 runner unavailable → http3_curl returns 1, suite skips or marks HTTP/3 tests).
_http3_fail() {
  if [[ "${HTTP3_STRICT:-0}" == "1" ]]; then
    if declare -F fail >/dev/null 2>&1; then
      fail "$1"
    else
      echo "HTTP/3 helper error: $1" >&2
      exit 1
    fi
    return
  fi
  echo "HTTP/3 helper error: $1" >&2
  return 1
}

_http3_warn() {
  if declare -F warn >/dev/null 2>&1; then
    warn "$1"
  else
    echo "HTTP/3 helper warning: $1" >&2
  fi
}

_http3_detect_kind_node() {
  local cluster="${HTTP3_KIND_CLUSTER:-${KIND_CLUSTER:-h3}}"
  local node=""
  
  # Try to find docker command (check common locations for Colima/k3s)
  local docker_cmd=""
  if command -v docker >/dev/null 2>&1; then
    docker_cmd="docker"
  elif [[ -f "$HOME/.colima/default/docker.sock" ]] || [[ -S "$HOME/.colima/default/docker.sock" ]]; then
    # Colima docker socket exists - try to use it via docker context or direct
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
    # Try to find docker in common locations
    for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
      if [[ -x "$d" ]]; then
        docker_cmd="$d"
        break
      fi
    done
  fi
  
  # First: Check if we're using Colima or k3s (check current kubectl context and cluster type)
  local current_ctx=$(kubectl config current-context 2>/dev/null || echo "")
  local cluster_type=""
  
  # Detect cluster type: check for k3s, colima, or kind
  if kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' 2>/dev/null | grep -q "k3s"; then
    cluster_type="k3s"
  elif [[ "$current_ctx" == *"colima"* ]] || [[ -n "${COLIMA_DOCKER_SOCKET:-}" ]]; then
    cluster_type="colima"
  elif command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q .; then
    cluster_type="kind"
  fi
  
  # For Colima/k3s: Use host network mode (direct access, no container namespace needed)
  if [[ "$cluster_type" == "k3s" ]] || [[ "$cluster_type" == "colima" ]]; then
    echo "HOST_NETWORK"
    return 0
  fi
  
  # For Colima: Try to find container if docker is available
  if [[ "$cluster_type" == "colima" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -iE "colima|lima" | head -n1 || true)"
    if [[ -n "$node" ]]; then
      echo "$node"
      return 0
    fi
    # Fallback: Use host network mode for Colima
    echo "HOST_NETWORK"
    return 0
  fi
  
  # Second: Try Kind cluster detection
  if [[ "$cluster_type" == "kind" ]] && command -v kind >/dev/null 2>&1; then
    # Try explicit cluster name first
    node="$(kind get nodes --name "$cluster" 2>/dev/null | head -n1 || true)"
    # Fallback: try any Kind cluster
    if [[ -z "$node" ]]; then
      node="$(kind get nodes 2>/dev/null | head -n1 || true)"
    fi
    if [[ -n "$node" ]]; then
      echo "$node"
      return 0
    fi
  fi
  
  # Fallback: try to detect from Docker containers (for Kind clusters)
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --filter "name=${cluster}-" --filter "name=kind-" --format "{{.Names}}" 2>/dev/null | grep -E "(control-plane|worker)" | head -n1 || true)"
  fi
  
  # Fallback: try to find any container with "kind" or cluster name in the name
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -iE "(kind|${cluster})" | head -n1 || true)"
  fi
  
  # Last resort: find any Kubernetes node container (h3-control-plane, h3-worker, etc.)
  if [[ -z "$node" ]] && [[ -n "$docker_cmd" ]]; then
    node="$($docker_cmd ps --format "{{.Names}}" 2>/dev/null | grep -E "(control-plane|worker)" | head -n1 || true)"
  fi
  
  # If still no node found and we have a cluster, default to HOST_NETWORK for Colima/k3s
  if [[ -z "$node" ]] && kubectl get nodes >/dev/null 2>&1; then
    # Assume Colima/k3s if we can reach the cluster but can't find a container node
    echo "HOST_NETWORK"
    return 0
  fi
  
  [[ -n "$node" ]] || return 1
  echo "$node"
}

_HTTP3_RUNNER_READY=""
_HTTP3_DOCKER_CMD=""

_http3_ensure_runner() {
  if [[ "$_HTTP3_RUNNER_READY" == "yes" ]]; then
    return 0
  elif [[ "$_HTTP3_RUNNER_READY" == "no" ]]; then
    return 1
  fi

  # Try to find docker command (check common locations for Colima/k3s)
  local docker_cmd=""
  if command -v docker >/dev/null 2>&1; then
    docker_cmd="docker"
  elif [[ -S "$HOME/.colima/default/docker.sock" ]] || [[ -f "$HOME/.colima/default/docker.sock" ]]; then
    # Colima docker socket exists - try to use it
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
    # Try to find docker in common locations
    for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
      if [[ -x "$d" ]]; then
        docker_cmd="$d"
        break
      fi
    done
  fi
  
  # If using HOST_NETWORK, we don't strictly need docker (but still need it for the image)
  # For HOST_NETWORK mode, we can use podman or any container runtime
  if [[ -z "$docker_cmd" ]]; then
    # Check if we're using HOST_NETWORK (Colima/k3s) - in that case, try to find alternative
    local detected_node="$(_http3_detect_kind_node 2>/dev/null || echo "")"
    if [[ "$detected_node" == "HOST_NETWORK" ]]; then
      # For HOST_NETWORK, we can try podman or warn but continue
      if command -v podman >/dev/null 2>&1; then
        docker_cmd="podman"
      else
        _HTTP3_RUNNER_READY="no"
        _http3_fail "Docker or Podman is required for HTTP/3 tests. Install docker or set DOCKER_HOST." || true
        return 1
      fi
    else
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Docker is required for HTTP/3 tests. Install docker or set DOCKER_HOST." || true
      return 1
    fi
  fi
  
  # Store docker command globally for use in http3_curl
  _HTTP3_DOCKER_CMD="$docker_cmd"

  # Docker-bridge path (host.docker.internal:18443): use HOST_NETWORK so container can reach host; no kind node needed
  if [[ -n "${HTTP3_DOCKER_FORWARD_PORT:-}" ]]; then
    HTTP3_KIND_NODE="${HTTP3_KIND_NODE:-HOST_NETWORK}"
  fi

  local node="${HTTP3_KIND_NODE:-}"
  if [[ -z "$node" ]]; then
    node="$(_http3_detect_kind_node)" || {
      _HTTP3_RUNNER_READY="no"
      _http3_fail "Unable to detect kind node; set HTTP3_KIND_NODE manually (or HTTP3_DOCKER_FORWARD_PORT=18443 for Docker bridge)." || true
      return 1
    }
    HTTP3_KIND_NODE="$node"
  fi

  # Prefer enhanced image (tcpdump, tshark, valgrind) when available; else alpine/curl-http3
  local default_image="alpine/curl-http3:latest"
  if docker image inspect "http3-curl-enhanced:latest" >/dev/null 2>&1; then
    default_image="http3-curl-enhanced:latest"
  fi
  HTTP3_IMAGE="${HTTP3_IMAGE:-$default_image}"
  
  # Pre-pull the image to avoid pull messages during test execution
  local image_exists=false
  if docker image inspect "$HTTP3_IMAGE" >/dev/null 2>&1; then
    image_exists=true
  elif [[ "$HTTP3_IMAGE" == *":latest" ]]; then
    local image_no_tag="${HTTP3_IMAGE%:latest}"
    if docker image inspect "$image_no_tag" >/dev/null 2>&1; then
      HTTP3_IMAGE="$image_no_tag"
      image_exists=true
    fi
  else
    if docker image inspect "${HTTP3_IMAGE}:latest" >/dev/null 2>&1; then
      HTTP3_IMAGE="${HTTP3_IMAGE}:latest"
      image_exists=true
    fi
  fi
  
  if [[ "$image_exists" == "false" ]]; then
    _http3_warn "Pulling HTTP/3 image: $HTTP3_IMAGE (this may take a moment)..."
    if ! docker pull "$HTTP3_IMAGE" >/dev/null 2>&1; then
      # Fallback: try alternative image when default pull fails (e.g. rate limit, registry issue)
      local fallback_images=("rmarx/curl-http3:latest" "alpine/curl-http3")
      for _img in "${fallback_images[@]}"; do
        [[ "$_img" == "$HTTP3_IMAGE" ]] && continue
        _http3_warn "Trying fallback image: $_img"
        if docker pull "$_img" >/dev/null 2>&1; then
          HTTP3_IMAGE="$_img"
          image_exists=true
          break
        fi
      done
      if [[ "$image_exists" != "true" ]]; then
        _HTTP3_RUNNER_READY="no"
        _http3_fail "Failed to pull HTTP/3 image. Set HTTP3_IMAGE to a local image (e.g. after building: ./scripts/build-http3-image.sh or docker build -t my-curl-http3 docker/http3-curl-enhanced/) or pull manually: docker pull alpine/curl-http3:latest" || true
        return 1
      fi
    fi
  fi
  
  _HTTP3_RUNNER_READY="yes"
}

http3_curl() {
  # --- Colima / MetalLB-only: never use NodePort (127.0.0.1:30443) — host cannot reach it ---
  local _ctx
  _ctx=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]] || [[ "$_ctx" == *"colima"* ]]; then
    if [[ -z "${TARGET_IP:-}" ]]; then
      TARGET_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    fi
    if [[ -n "${TARGET_IP:-}" ]]; then
      export HTTP3_USE_LB_IP=1
      export HTTP3_SKIP_DOCKER_BRIDGE=1
    fi
  fi

  # --- QUIC Hostname Invariant Enforcement ---
  local expected_host="${HTTP3_EXPECTED_HOST:-off-campus-housing.local}"
  local request_host=""
  if [[ "${HTTP3_ENFORCE_HOSTNAME:-1}" == "1" ]]; then
    for arg in "$@"; do
      if [[ "$arg" =~ ^https://([^/:]+) ]]; then
        request_host="${BASH_REMATCH[1]}"
        break
      fi
    done
    if [[ -z "${request_host:-}" ]]; then
      echo "HTTP/3 invariant violation: no https:// URL provided." >&2
      return 98
    fi
    if [[ "$request_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "HTTP/3 invariant violation: QUIC must not use raw IP ($request_host)." >&2
      return 97
    fi
    if [[ "$request_host" != "$expected_host" ]]; then
      echo "HTTP/3 invariant violation: host '$request_host' != expected '$expected_host'." >&2
      return 96
    fi
  fi
  # --- End Enforcement ---

  local lb_ip="${TARGET_IP:-}"
  [[ -z "$lb_ip" ]] && lb_ip="127.0.0.1"
  local resolve_port="${HTTP3_RESOLVE_PORT:-${PORT:-443}}"
  # Colima/MetalLB-only: force LB IP and port 443 — never NodePort
  if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]] || [[ "${_ctx:-}" == *"colima"* ]]; then
    if [[ -n "${TARGET_IP:-}" ]]; then
      lb_ip="$TARGET_IP"
      resolve_port="443"
    fi
  fi

  # Disable GSO to avoid sendmsg errno 5 (EIO) on macOS / Docker VM (QUIC)
  export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"
  # When HTTP3_USE_NATIVE_CURL=1 (Darwin + LB IP): try native curl first — host can reach LB IP:443; avoids Docker bridge
  local curl_cmd="curl"
  [[ -n "${CURL_BIN:-}" ]] && [[ -x "${CURL_BIN}" ]] && curl_cmd="$CURL_BIN"
  if [[ "${HTTP3_USE_NATIVE_CURL:-0}" == "1" ]] && "$curl_cmd" --help all 2>/dev/null | grep -q -- "--http3"; then
    # Pace HTTP/3 calls to reduce QUIC burst and UDP drop (Colima/MetalLB)
    sleep "${HTTP3_PACE_SECONDS:-0.15}" 2>/dev/null || true
    local output
    local native_args=()
    # Never reuse QUIC connection (avoids curl exit 55 after long run / QUIC idle reuse)
    native_args+=(--no-keepalive)
    # Fresh connection per request (avoids QUIC reuse issues)
    native_args+=(-H "Connection: close")
    # Deterministic timeouts: 10s max, 2s connect (stabilizes H3 handshake and checkout on Colima)
    # 10s default helps checkout/QUIC on Colima; override with HTTP3_MAX_TIME if needed
echo " $* " | grep -qE ' --max-time [0-9]+' || native_args+=(--max-time "${HTTP3_MAX_TIME:-10}")
    echo " $* " | grep -qE ' --connect-timeout [0-9]+' || native_args+=(--connect-timeout "${HTTP3_CONNECT_TIMEOUT:-2}")
    # Retry on timeout/refused to reduce exit 28/55 under load
    echo " $* " | grep -qE ' --retry [0-9]+' || native_args+=(--retry 2 --retry-delay 0 --retry-connrefused)
    if [[ "${HTTP3_AUTO_RESOLVE:-1}" == "1" ]]; then
      native_args+=(--resolve "${expected_host}:${resolve_port}:${lb_ip}")
    fi
    native_args+=("$@")
    output=$(NGTCP2_ENABLE_GSO=0 "$curl_cmd" "${native_args[@]}" 2>&1)
    local exit_code=$?
    # Retry once on exit 55 (QUIC send failure) or 28 (timeout)
    if [[ "${HTTP3_RETRY_ON_55:-1}" == "1" ]] && { [[ "$exit_code" -eq 55 ]] || [[ "$exit_code" -eq 28 ]]; }; then
      sleep 0.5
      output=$(NGTCP2_ENABLE_GSO=0 "$curl_cmd" "${native_args[@]}" 2>&1)
      exit_code=$?
    fi
    if [[ "${HTTP3_ASSERT_ALPN:-0}" == "1" ]] && ! echo "$output" | grep -qi "using HTTP/3"; then
      echo "❌ ALPN invariant violation: connection did not negotiate HTTP/3." >&2
      return 95
    fi
    echo "$output"
    return $exit_code
  fi

  _http3_ensure_runner || return 1
  
  local output exit_code
  
  # Use docker command found during _http3_ensure_runner
  local docker_cmd="${_HTTP3_DOCKER_CMD:-docker}"
  
  # Ensure PATH includes common locations
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  
  # Fallback: try to find docker if not set
  if [[ -z "$docker_cmd" ]] || ! command -v "$docker_cmd" >/dev/null 2>&1; then
    if command -v docker >/dev/null 2>&1; then
      docker_cmd="docker"
    elif [[ -S "$HOME/.colima/default/docker.sock" ]] || [[ -f "$HOME/.colima/default/docker.sock" ]]; then
      export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" 2>/dev/null || true
      # Try common locations
      for d in /usr/local/bin/docker /opt/homebrew/bin/docker /usr/bin/docker; do
        if [[ -x "$d" ]]; then
          docker_cmd="$d"
          break
        fi
      done
    fi
  fi
  
  # Verify docker command works
  if ! command -v "$docker_cmd" >/dev/null 2>&1 && [[ -z "${DOCKER_HOST:-}" ]]; then
    _http3_warn "Docker command not found - HTTP/3 tests will fail. Install docker or set DOCKER_HOST."
    return 1
  fi
  
  # Extract --cacert argument and mount the certificate file if present
  local cacert_path=""
  local curl_args=()
  local mount_args=()
  local args_array=("$@")
  local i=0
  while [[ $i -lt ${#args_array[@]} ]]; do
    local arg="${args_array[$i]}"
    if [[ "$arg" == "--cacert" ]] && [[ $((i+1)) -lt ${#args_array[@]} ]]; then
      local cert_file="${args_array[$((i+1))]}"
      if [[ -f "$cert_file" ]] && [[ -s "$cert_file" ]]; then
        # Mount the certificate file into the container
        # Use a simple, predictable path inside the container
        cacert_path="/tmp/ca-cert.pem"
        # Ensure the file is readable and use absolute path for mount
        local abs_cert_file
        if [[ "$cert_file" = /* ]]; then
          # Already absolute path
          abs_cert_file="$cert_file"
        else
          # Convert to absolute path
          abs_cert_file="$(cd "$(dirname "$cert_file")" && pwd)/$(basename "$cert_file")"
        fi
        # Verify file exists and is readable before mounting
        if [[ -r "$abs_cert_file" ]] && [[ -s "$abs_cert_file" ]]; then
          # Mount to /tmp to avoid directory conflicts
          # Use a unique filename to avoid conflicts
          cacert_path="/tmp/http3-ca-$$.pem"
          # For --network host, we need to ensure the file is mounted correctly
          # Try mounting as a file explicitly
          mount_args+=("-v" "$abs_cert_file:$cacert_path:ro")
          curl_args+=("--cacert" "$cacert_path")
          i=$((i+2))
          continue
        else
          _http3_warn "CA certificate file not readable or empty: $abs_cert_file"
        fi
      else
        _http3_warn "CA certificate file not found or empty: $cert_file"
      fi
    fi
    curl_args+=("$arg")
    i=$((i+1))
  done

  # Auto-inject --resolve so hostname/SNI is correct (avoid accidental IP QUIC; Caddy serves off-campus-housing.local so SNI must match).
  # Docker bridge: use 127.0.0.1:DOCKER_FORWARD_PORT so container (--network host) hits host's socat when native curl to LB IP failed.
  local _resolve_ip="$lb_ip"
  local _resolve_port="$resolve_port"
  if [[ -n "${HTTP3_DOCKER_FORWARD_PORT:-}" ]]; then
    _resolve_port="${HTTP3_DOCKER_FORWARD_PORT}"
    _resolve_ip="${DOCKER_HOST_IP:-127.0.0.1}"
  fi
  if [[ "${HTTP3_AUTO_RESOLVE:-1}" == "1" ]]; then
    curl_args=(--resolve "${expected_host}:${_resolve_port}:${_resolve_ip}" "${curl_args[@]}")
  fi
  
  # Skip Docker bridge when requested (use only native curl to LB IP; fewer hops)
  [[ "${HTTP3_SKIP_DOCKER_BRIDGE:-0}" == "1" ]] && unset HTTP3_DOCKER_FORWARD_PORT
  # Check if we should use host network (for Colima/k3s or when no container network available)
  if [[ "$HTTP3_KIND_NODE" == "HOST_NETWORK" ]]; then
    # Use host network mode - works for Colima/k3s and direct host access
    # For host network, we need to resolve to 127.0.0.1 with the correct port
    # Replace any --resolve arguments that use service IP with 127.0.0.1
    local final_curl_args=()
    local i=0
    while [[ $i -lt ${#curl_args[@]} ]]; do
      local arg="${curl_args[$i]}"
      if [[ "$arg" == "--resolve" ]] && [[ $((i+1)) -lt ${#curl_args[@]} ]]; then
        local resolve_val="${curl_args[$((i+1))]}"
        # Extract host:port:ip from resolve value
        if [[ "$resolve_val" =~ ^([^:]+):([0-9]+):(.+)$ ]]; then
          local resolve_host="${BASH_REMATCH[1]}"
          local resolve_port="${BASH_REMATCH[2]}"
          local resolve_ip="${BASH_REMATCH[3]}"
          # Colima/MetalLB-only: NEVER rewrite to NodePort (127.0.0.1:30443) — host cannot reach it.
          # Docker-on-macOS bridge: port 18443 = host.docker.internal; never rewrite to NodePort.
          local docker_fwd_port="${HTTP3_DOCKER_FORWARD_PORT:-18443}"
          if [[ "${FORCE_METALLB_ONLY:-0}" == "1" ]]; then
            : # never rewrite to NodePort on Colima
          elif [[ "$resolve_port" == "$docker_fwd_port" ]]; then
            : # keep resolve as-is (host.docker.internal:18443)
          elif [[ "${HTTP3_USE_LB_IP:-0}" == "1" ]]; then
            : # keep LB IP / Docker host IP
          elif [[ -n "${TARGET_IP:-}" ]] && [[ "$resolve_ip" == "${TARGET_IP}" ]] && [[ "$resolve_port" == "443" ]]; then
            : # MetalLB: keep off-campus-housing.local:443:LB_IP; do not rewrite to 127.0.0.1:30443
          elif [[ "$resolve_ip" == "127.0.0.1" ]] && [[ "$resolve_port" == "30443" ]]; then
            # Caller passed NodePort — on Colima this fails. Override to LB IP when available.
            if [[ -n "${TARGET_IP:-}" ]]; then
              resolve_val="${resolve_host}:443:${TARGET_IP}"
            fi
          elif [[ "$resolve_ip" =~ ^10\. ]] || [[ "$resolve_ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] || [[ "$resolve_ip" =~ ^192\.168\. ]]; then
            local nodeport="${CADDY_NODEPORT:-${PORT:-30443}}"
            resolve_val="${resolve_host}:${nodeport}:127.0.0.1"
            local url_idx=0
            for ((url_i=0; url_i<${#final_curl_args[@]}; url_i++)); do
              if [[ "${final_curl_args[$url_i]}" =~ ^https://${resolve_host}(:443)?(/.*)?$ ]]; then
                final_curl_args[$url_i]="${final_curl_args[$url_i]//:443/:${nodeport}}"
                if [[ "${final_curl_args[$url_i]}" =~ ^https://${resolve_host}/ ]]; then
                  final_curl_args[$url_i]="${final_curl_args[$url_i]//https:\/\/${resolve_host}\//https:\/\/${resolve_host}:${nodeport}\/}"
                fi
              fi
            done
          fi
        fi
        final_curl_args+=("--resolve" "$resolve_val")
        i=$((i+2))
        continue
      fi
      final_curl_args+=("$arg")
      i=$((i+1))
    done
    
    # Update URL arguments: NodePort (when not using LB IP), Docker forward port (when HTTP3_DOCKER_FORWARD_PORT), or keep 443
    if [[ -n "${HTTP3_DOCKER_FORWARD_PORT:-}" ]]; then
      # Docker-on-macOS bridge: resolve uses host.docker.internal:18443; URLs must use that port
      local df_port="$HTTP3_DOCKER_FORWARD_PORT"
      for ((url_idx=0; url_idx<${#final_curl_args[@]}; url_idx++)); do
        local url_arg="${final_curl_args[$url_idx]}"
        if [[ "$url_arg" =~ ^https://([^:/]+)(:443)?(/.*)?$ ]]; then
          local host_part="${BASH_REMATCH[1]}"
          local path_part="${BASH_REMATCH[3]:-/}"
          final_curl_args[$url_idx]="https://${host_part}:${df_port}${path_part}"
        fi
      done
    elif [[ "${HTTP3_USE_LB_IP:-0}" != "1" ]]; then
      local nodeport="${CADDY_NODEPORT:-${PORT:-30443}}"
      for ((url_idx=0; url_idx<${#final_curl_args[@]}; url_idx++)); do
        local url_arg="${final_curl_args[$url_idx]}"
        if [[ "$url_arg" =~ ^https://([^:/]+)(:443)?(/.*)?$ ]]; then
          local host_part="${BASH_REMATCH[1]}"
          local path_part="${BASH_REMATCH[3]:-/}"
          final_curl_args[$url_idx]="https://${host_part}:${nodeport}${path_part}"
        fi
      done
    fi
    
    # For --network host, volume mounts may not work reliably with Colima
    # Use base64 encoding to pass CA cert content via environment variable
    local ca_cert_b64=""
    local source_ca_file=""
    if [[ ${#mount_args[@]} -gt 0 ]]; then
      # Extract the source file path from mount_args (format: -v /path/to/file:/dest:ro)
      for ((j=0; j<${#mount_args[@]}; j++)); do
        if [[ "${mount_args[$j]}" == "-v" ]] && [[ $((j+1)) -lt ${#mount_args[@]} ]]; then
          local mount_spec="${mount_args[$((j+1))]}"
          source_ca_file="${mount_spec%%:*}"
          if [[ -f "$source_ca_file" ]] && [[ -r "$source_ca_file" ]]; then
            # Base64 encode to avoid shell escaping issues
            ca_cert_b64=$(base64 < "$source_ca_file" | tr -d '\n')
            # Remove the mount args since we'll use env var instead
            mount_args=()
            break
          fi
        fi
      done
    fi
    
    # If we have CA cert, pass it via base64 env var and decode in container
    if [[ -n "$ca_cert_b64" ]] && [[ -n "$source_ca_file" ]]; then
      # Find --cacert argument and update path
      local updated_curl_args=()
      local cert_path="/tmp/http3-ca-cert.pem"
      local i=0
      while [[ $i -lt ${#final_curl_args[@]} ]]; do
        if [[ "${final_curl_args[$i]}" == "--cacert" ]] && [[ $((i+1)) -lt ${#final_curl_args[@]} ]]; then
          updated_curl_args+=("--cacert" "$cert_path")
          i=$((i+2))
        else
          updated_curl_args+=("${final_curl_args[$i]}")
          i=$((i+1))
        fi
      done
      final_curl_args=("${updated_curl_args[@]}")
      
      # Create file in container by decoding base64
      # Build the curl command string carefully to avoid shell injection
      local curl_cmd_parts=()
      for arg in "${final_curl_args[@]}"; do
        # Escape single quotes and wrap in single quotes
        local escaped_arg=$(printf '%s\n' "$arg" | sed "s/'/'\"'\"'/g")
        curl_cmd_parts+=("'$escaped_arg'")
      done
      
      local curl_cmd_str=$(IFS=' '; echo "${curl_cmd_parts[*]}")
      
      output=$($docker_cmd run --rm \
        --network host \
        -e "NGTCP2_ENABLE_GSO=0" \
        -e "CA_CERT_B64=$ca_cert_b64" \
        "$HTTP3_IMAGE" \
        sh -c "echo \"\$CA_CERT_B64\" | base64 -d > $cert_path && curl $curl_cmd_str" 2>&1)
      exit_code=$?
    else
      # Fallback to mount if no CA cert (shouldn't happen, but safe fallback)
      output=$($docker_cmd run --rm \
        --network host \
        -e "NGTCP2_ENABLE_GSO=0" \
        "${mount_args[@]}" \
        "$HTTP3_IMAGE" \
        curl "${final_curl_args[@]}" 2>&1)
      exit_code=$?
    fi
  else
    # Use container network namespace (for Kind clusters)
    output=$($docker_cmd run --rm \
      -e "NGTCP2_ENABLE_GSO=0" \
      --network "container:${HTTP3_KIND_NODE}" \
      "${mount_args[@]}" \
      "$HTTP3_IMAGE" \
      curl "${curl_args[@]}" 2>&1)
    exit_code=$?
  fi
  
  # Filter out Docker pull messages (they appear on stderr but get mixed with curl output)
  # Keep everything else, including legitimate curl errors
  output=$(echo "$output" | grep -v "Unable to find image\|Pulling from\|Pull complete\|Digest:\|Status:")
  
  # ALPN invariant: require HTTP/3 negotiated (use -v in caller for "using HTTP/3" in output)
  if [[ "${HTTP3_ASSERT_ALPN:-0}" == "1" ]] && ! echo "$output" | grep -qi "using HTTP/3"; then
    echo "❌ ALPN invariant violation: connection did not negotiate HTTP/3." >&2
    return 95
  fi
  
  # Print the filtered output
  echo "$output"
  
  # Return the original exit code
  return $exit_code
}

