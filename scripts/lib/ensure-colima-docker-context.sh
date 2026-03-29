#!/usr/bin/env bash
# When kubectl context is Colima, point docker CLI at Colima's Docker socket so
# `docker image inspect` matches images used for `docker build -t service:dev`.
#
# Usage (from repo root or scripts):
#   source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
#   export OCH_KUBE_CONTEXT="$(kubectl config current-context 2>/dev/null)"
#   och_ensure_colima_docker_context || exit 1
#
# Env:
#   OCH_KUBE_CONTEXT — if unset, uses kubectl current-context (if *colima*, enforce socket)
#   OCH_FORCE_COLIMA_DOCKER — 1: apply Colima docker context even if kube context name lacks "colima"

och_ensure_colima_docker_context() {
  local kube_ctx="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || true)}"
  if [[ "${OCH_FORCE_COLIMA_DOCKER:-0}" != "1" ]] && [[ "$kube_ctx" != *colima* ]]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  if command -v colima >/dev/null 2>&1; then
    docker context use colima >/dev/null 2>&1 || true
  fi

  local sock=""
  for cand in "$HOME/.colima/default/docker.sock" "$HOME/.colima/docker.sock"; do
    if [[ -S "$cand" ]]; then
      sock="$cand"
      break
    fi
  done
  if [[ -z "$sock" ]] && command -v colima >/dev/null 2>&1; then
    local profile
    profile=$(colima status 2>/dev/null | awk -F': ' '/^[Pp]rofile:/{gsub(/ /,"",$2); print $2; exit}' || true)
    [[ -z "$profile" ]] && profile=default
    if [[ -S "$HOME/.colima/${profile}/docker.sock" ]]; then
      sock="$HOME/.colima/${profile}/docker.sock"
    fi
  fi

  if [[ -n "$sock" ]]; then
    export DOCKER_HOST="unix://${sock}"
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon unreachable after Colima context setup (context=$(docker context show 2>/dev/null || echo ?), DOCKER_HOST=${DOCKER_HOST:-<unset>}). Start Colima: colima start" >&2
    return 1
  fi
  return 0
}

# Allow: bash scripts/lib/ensure-colima-docker-context.sh (print status)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  och_ensure_colima_docker_context || exit 1
  echo "✅ Docker OK — context=$(docker context show 2>/dev/null) DOCKER_HOST=${DOCKER_HOST:-<default>}"
fi
