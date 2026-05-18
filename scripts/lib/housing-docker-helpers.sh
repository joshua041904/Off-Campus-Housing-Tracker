#!/usr/bin/env bash
# Shared helpers for housing Colima / k3s image scripts.
# shellcheck disable=SC2086

# Trim, collapse whitespace, dedupe tokens (order-preserving).
housing_normalize_service_list() {
  local raw="${1:-}"
  raw="${raw//,/ }"
  raw="$(echo "${raw}" | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')"
  local out="" seen="|"
  for tok in ${raw}; do
    [[ -z "${tok}" ]] && continue
    case "${seen}" in
      *"|${tok}|"*) continue ;;
    esac
    seen="${seen}${tok}|"
    out="${out}${tok} "
  done
  echo "${out% }"
}

# Remove one service name from a space-separated list (normalized).
housing_remove_service() {
  local drop="${1:?}"
  local raw="${2:-}"
  local out="" tok
  for tok in ${raw}; do
    [[ "${tok}" == "${drop}" ]] && continue
    out="${out}${tok} "
  done
  echo "${out% }"
}

# Append api-gateway once if any of these services are present (gateway caches / route tables).
housing_ensure_api_gateway_rollout() {
  local raw="${1:-}"
  local need=0 tok
  for tok in ${raw}; do
    if [[ "${tok}" == "notification-service" || "${tok}" == "webapp" || "${tok}" == "booking-service" || "${tok}" == "trust-service" ]]; then
      need=1
      break
    fi
  done
  [[ "${need}" -eq 1 ]] || { echo "${raw}"; return 0; }
  for tok in ${raw}; do
    [[ "${tok}" == "api-gateway" ]] && { echo "${raw}"; return 0; }
  done
  echo "${raw} api-gateway"
}

# Fail fast when DOCKER_HOST overrides the active context (common Colima footgun).
housing_require_clean_docker_host() {
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    echo "DOCKER_HOST is set (${DOCKER_HOST}). Unset it so the CLI uses the Colima context: unset DOCKER_HOST" >&2
    return 1
  fi
  return 0
}

# Switch CLI to Colima if that context exists (housing scripts assume Colima/k3s dev).
housing_use_colima_docker_context() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker CLI not found in PATH." >&2
    return 1
  fi
  if ! docker context ls --format '{{.Name}}' 2>/dev/null | grep -qx colima; then
    echo "Docker context 'colima' not found. Install/start Colima or create the context." >&2
    return 1
  fi
  docker context use colima >/dev/null
  return 0
}

# True when the engine answers (not just client metadata).
housing_docker_engine_version() {
  docker info -f '{{.ServerVersion}}' 2>/dev/null || true
}

housing_require_docker_daemon() {
  local sv
  sv="$(housing_docker_engine_version)"
  if [[ -z "${sv}" ]]; then
    echo "Docker engine unreachable (no ServerVersion from 'docker info'). Try: unset DOCKER_HOST && docker context use colima && colima restart" >&2
    return 1
  fi
  return 0
}

housing_require_colima_running() {
  if ! command -v colima >/dev/null 2>&1; then
    echo "colima CLI not found; install Colima for this workflow." >&2
    return 1
  fi
  if ! colima status >/dev/null 2>&1; then
    echo "Colima is not healthy/running ('colima status' failed). Try: colima restart" >&2
    return 1
  fi
  return 0
}

# Warn when many unused image layers are reclaimable (suggests prune before heavy builds).
housing_warn_large_image_reclaimable() {
  local threshold_gb="${1:-25}"
  local line rec num
  line="$(docker system df --format '{{.Type}}@{{.Reclaimable}}' 2>/dev/null | awk -F@ '$1=="Images"{print; exit}')"
  [[ -n "${line}" ]] || return 0
  rec="${line#*@}"
  num="${rec%%GB*}"
  [[ "${num}" =~ ^[0-9.]+$ ]] || return 0
  awk -v n="${num}" -v t="${threshold_gb}" 'BEGIN{ exit !(n+0 > t+0) }' || return 0
  echo "⚠️  Docker reports ~${num}GB reclaimable on Images (threshold ${threshold_gb}GB). Consider: docker system prune -af && docker buildx prune -af" >&2
  return 0
}
