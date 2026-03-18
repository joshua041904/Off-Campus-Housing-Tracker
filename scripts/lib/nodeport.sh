#!/usr/bin/env bash

# Shared helpers for issuing HTTPS requests via NodePort on macOS
# Reuses the control-plane node's network namespace to bypass macOS/Kind TLS handshake issues
# Similar to http3.sh but for HTTP/2 over NodePort

_nodeport_fail() {
  if declare -F fail >/dev/null 2>&1; then
    fail "$1"
  else
    echo "NodePort helper error: $1" >&2
    exit 1
  fi
}

_nodeport_warn() {
  if declare -F warn >/dev/null 2>&1; then
    warn "$1"
  else
    echo "NodePort helper warning: $1" >&2
  fi
}

_nodeport_detect_kind_node() {
  local cluster="${NODEPORT_KIND_CLUSTER:-${KIND_CLUSTER:-h3}}"
  local node=""
  if command -v kind >/dev/null 2>&1; then
    node="$(kind get nodes --name "$cluster" 2>/dev/null | head -n1 || true)"
    if [[ -z "$node" ]]; then
      node="$(kind get nodes 2>/dev/null | head -n1 || true)"
    fi
  fi
  [[ -n "$node" ]] || return 1
  echo "$node"
}

_NODEPORT_RUNNER_READY=""
_NODEPORT_PERSISTENT_CONTAINER=""

_nodeport_ensure_runner() {
  if [[ "$_NODEPORT_RUNNER_READY" == "yes" ]]; then
    return 0
  elif [[ "$_NODEPORT_RUNNER_READY" == "no" ]]; then
    return 1
  fi

  command -v docker >/dev/null 2>&1 || {
    _NODEPORT_RUNNER_READY="no"
    _nodeport_fail "Docker is required for NodePort tests."
  }

  local node="${NODEPORT_KIND_NODE:-}"
  if [[ -z "$node" ]]; then
    node="$(_nodeport_detect_kind_node)" || {
      _NODEPORT_RUNNER_READY="no"
      _nodeport_fail "Unable to detect kind node; set NODEPORT_KIND_NODE manually."
    }
    NODEPORT_KIND_NODE="$node"
  fi

  # Use curl image that supports HTTP/2 and TLS
  NODEPORT_IMAGE="${NODEPORT_IMAGE:-curlimages/curl:latest}"
  
  # Pre-pull the image to avoid pull messages during test execution
  local image_exists=false
  if docker image inspect "$NODEPORT_IMAGE" >/dev/null 2>&1; then
    image_exists=true
  elif [[ "$NODEPORT_IMAGE" == *":latest" ]]; then
    local image_no_tag="${NODEPORT_IMAGE%:latest}"
    if docker image inspect "$image_no_tag" >/dev/null 2>&1; then
      NODEPORT_IMAGE="$image_no_tag"
      image_exists=true
    fi
  else
    if docker image inspect "${NODEPORT_IMAGE}:latest" >/dev/null 2>&1; then
      NODEPORT_IMAGE="${NODEPORT_IMAGE}:latest"
      image_exists=true
    fi
  fi
  
  if [[ "$image_exists" == "false" ]]; then
    _nodeport_warn "Pulling curl image: $NODEPORT_IMAGE (this may take a moment)..."
    docker pull "$NODEPORT_IMAGE" >/dev/null 2>&1 || {
      _NODEPORT_RUNNER_READY="no"
      _nodeport_fail "Failed to pull curl image: $NODEPORT_IMAGE"
    }
  fi
  
  _NODEPORT_RUNNER_READY="yes"
}

# Create/ensure persistent curl container for connection reuse
_nodeport_ensure_persistent_container() {
  local container_name="nodeport-curl-${NODEPORT_KIND_NODE:-h3-control-plane}"
  
  # Check if container exists and is running
  if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
    _NODEPORT_PERSISTENT_CONTAINER="$container_name"
    return 0
  fi
  
  # Check if container exists but is stopped
  if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
    docker start "$container_name" >/dev/null 2>&1 || true
    _NODEPORT_PERSISTENT_CONTAINER="$container_name"
    return 0
  fi
  
  # Create new persistent container
  _nodeport_ensure_runner || return 1
  
  docker run -d --name "$container_name" \
    --network "container:${NODEPORT_KIND_NODE}" \
    "$NODEPORT_IMAGE" \
    sleep infinity >/dev/null 2>&1 || {
    _nodeport_warn "Failed to create persistent container, using one-off containers"
    _NODEPORT_PERSISTENT_CONTAINER=""
    return 1
  }
  
  _NODEPORT_PERSISTENT_CONTAINER="$container_name"
  return 0
}

# Cleanup persistent container
_nodeport_cleanup_persistent_container() {
  if [[ -n "$_NODEPORT_PERSISTENT_CONTAINER" ]]; then
    docker rm -f "$_NODEPORT_PERSISTENT_CONTAINER" >/dev/null 2>&1 || true
    _NODEPORT_PERSISTENT_CONTAINER=""
  fi
}

nodeport_curl() {
  # For high-throughput scenarios, prefer port-forward (works on macOS)
  # For single requests, try direct curl first, then Docker fallback
  local output exit_code
  local curl_bin="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
  local use_port_forward="${NODEPORT_USE_PORT_FORWARD:-}"
  
  # If port-forward is available and enabled, use it (fast, enables HTTP/2 multiplexing)
  if [[ -n "$use_port_forward" ]] && [[ "$use_port_forward" != "0" ]]; then
    # Rewrite URL to use port-forward port (typically 8443)
    local port_forward_port="${NODEPORT_PORT_FORWARD:-8443}"
    local curl_args=("$@")
    local new_args=()
    
    for arg in "${curl_args[@]}"; do
      if [[ "$arg" =~ ^https://[^:]+:[0-9]+ ]]; then
        # Replace port with port-forward port
        new_args+=("${arg//:30443/:${port_forward_port}}")
      elif [[ "$arg" =~ ^https://[^/]+(/.+)?$ ]]; then
        # Add port-forward port
        new_args+=("${arg//https:\/\//https:\/\/127.0.0.1:${port_forward_port}\/}")
      else
        new_args+=("$arg")
      fi
    done
    
    output=$("$curl_bin" "${new_args[@]}" 2>&1)
    exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
      echo "$output"
      return 0
    fi
  fi
  
  # Try direct curl first (fast path - enables HTTP/2 multiplexing)
  set +e  # Don't exit on curl failure
  output=$("$curl_bin" "$@" 2>&1)
  exit_code=$?
  set -e
  
  # Check for TLS errors (macOS/Kind TLS forwarding issue)
  if [[ $exit_code -eq 35 ]] || echo "$output" | grep -qE "(curl: \(35\)|TLS connect error|error:0A000126|unexpected eof|SSL routines|handshake failure)"; then
    # TLS error detected, use Docker workaround
    # For high-throughput scenarios, use persistent container for connection reuse
    _nodeport_ensure_runner || return 1
    
    # Build curl command for Docker - replace --resolve with direct IP
    local curl_args=("$@")
    local new_args=()
    local skip_next=false
    local port="${NODEPORT_PORT:-30443}"
    
    # Process arguments to handle --resolve and URL rewriting
    for i in "${!curl_args[@]}"; do
      if [[ "$skip_next" == "true" ]]; then
        skip_next=false
        continue
      fi
      
      local arg="${curl_args[$i]}"
      
      # Skip --resolve flags (not needed inside node)
      if [[ "$arg" == "--resolve" ]]; then
        skip_next=true
        continue
      fi
      
      # Rewrite URLs to use 127.0.0.1:PORT instead of hostname:PORT
      if [[ "$arg" =~ ^https://[^:]+:[0-9]+ ]]; then
        # URL with port: https://hostname:PORT/path -> https://127.0.0.1:PORT/path
        local url_without_proto="${arg#https://}"
        local host_port="${url_without_proto%%/*}"
        local path="${url_without_proto#*/}"
        # Extract port from host:port
        local url_port="${host_port##*:}"
        if [[ "$url_port" == "$host_port" ]]; then
          # No port in URL, use default
          url_port="$port"
          path="$url_without_proto"
        fi
        new_args+=("https://127.0.0.1:${url_port}/${path}")
      elif [[ "$arg" =~ ^https://[^/]+(/.+)?$ ]]; then
        # URL without port: https://hostname/path -> https://127.0.0.1:PORT/path
        local url_without_proto="${arg#https://}"
        local path="${url_without_proto#*/}"
        new_args+=("https://127.0.0.1:${port}/${path}")
      else
        new_args+=("$arg")
      fi
    done
    
    # Try persistent container first (for connection reuse and HTTP/2 multiplexing)
    if _nodeport_ensure_persistent_container 2>/dev/null; then
      # Use persistent container - enables connection reuse and HTTP/2 multiplexing
      output=$(docker exec "$_NODEPORT_PERSISTENT_CONTAINER" \
        curl "${new_args[@]}" 2>&1)
      exit_code=$?
    else
      # Fallback to one-off container (slower, no connection reuse)
      output=$(docker run --rm \
        --network "container:${NODEPORT_KIND_NODE}" \
        "$NODEPORT_IMAGE" \
        curl "${new_args[@]}" 2>&1)
      exit_code=$?
      
      # Filter out Docker pull messages
      output=$(echo "$output" | grep -v "Unable to find image\|Pulling from\|Pull complete\|Digest:\|Status:")
    fi
  fi
  
  echo "$output"
  return $exit_code
}

# Force Docker workaround (for testing/debugging)
nodeport_curl_docker() {
  _nodeport_ensure_runner || return 1
  
  # Build curl command for Docker
  local curl_args=("$@")
  local new_args=()
  local skip_next=false
  local port="${NODEPORT_PORT:-30443}"
  
  # Process arguments (same logic as in nodeport_curl)
  for i in "${!curl_args[@]}"; do
    if [[ "$skip_next" == "true" ]]; then
      skip_next=false
      continue
    fi
    
    local arg="${curl_args[$i]}"
    
    if [[ "$arg" == "--resolve" ]]; then
      skip_next=true
      continue
    fi
    
    if [[ "$arg" =~ ^https://[^:]+:[0-9]+ ]]; then
      local url_without_proto="${arg#https://}"
      local host_port="${url_without_proto%%/*}"
      local path="${url_without_proto#*/}"
      local url_port="${host_port##*:}"
      if [[ "$url_port" == "$host_port" ]]; then
        url_port="$port"
        path="$url_without_proto"
      fi
      new_args+=("https://127.0.0.1:${url_port}/${path}")
    elif [[ "$arg" =~ ^https://[^/]+(/.+)?$ ]]; then
      local url_without_proto="${arg#https://}"
      local path="${url_without_proto#*/}"
      new_args+=("https://127.0.0.1:${port}/${path}")
    else
      new_args+=("$arg")
    fi
  done
  
  # Run curl inside the Kind node's network namespace
  local output exit_code
  output=$(docker run --rm \
    --network "container:${NODEPORT_KIND_NODE}" \
    "$NODEPORT_IMAGE" \
    curl "${new_args[@]}" 2>&1)
  exit_code=$?
  
  # Filter out Docker pull messages
  output=$(echo "$output" | grep -v "Unable to find image\|Pulling from\|Pull complete\|Digest:\|Status:")
  
  echo "$output"
  return $exit_code
}

