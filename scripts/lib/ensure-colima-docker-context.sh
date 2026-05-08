#!/usr/bin/env bash
# When kubectl context is Colima, align the Docker CLI with Colima's daemon socket so
# `docker image inspect` matches images used for `docker build -t service:dev`.
#
# Handles: (1) stale DOCKER_HOST in the environment; (2) broken `docker context colima` whose
# embedded host is still ~/.colima/default/docker.sock while the live socket is another path
# or missing until `colima start` recreates it — we find any working docker.sock under ~/.colima
# and optionally `docker context update colima` so plain `docker context use colima` works again.
#
# Usage (from repo root or scripts):
#   source "$SCRIPT_DIR/lib/ensure-colima-docker-context.sh"
#   export OCH_KUBE_CONTEXT="$(kubectl config current-context 2>/dev/null)"
#   och_ensure_colima_docker_context || exit 1
#
# Env:
#   OCH_KUBE_CONTEXT — if unset, uses kubectl current-context (if *colima*, enforce socket)
#   OCH_FORCE_COLIMA_DOCKER — 1: apply Colima docker context even if kube context name lacks "colima"
#   OCH_COLIMA_FIX_DOCKER_CONTEXT — 0: do not rewrite the colima context's docker endpoint (default 1 when we recover via a socket)

och_ensure_colima_docker_context() {
  local kube_ctx="${OCH_KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || true)}"
  if [[ "${OCH_FORCE_COLIMA_DOCKER:-0}" != "1" ]] && [[ "$kube_ctx" != *colima* ]]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  # Stale DOCKER_HOST / DOCKER_CONTEXT from another shell or a long-running script overrides
  # `docker context use` and causes "Cannot connect to the Docker daemon at unix://...colima/..." drift.
  unset DOCKER_HOST
  unset DOCKER_CONTEXT

  if command -v colima >/dev/null 2>&1; then
    docker context use colima >/dev/null 2>&1 || true
  fi

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  # The named "colima" context often hard-codes ~/.colima/default/docker.sock; the live socket may be
  # under another profile dir, missing after upgrade, or not yet created — scan and probe each socket.
  local sock="" candidate fixed_sock=""
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    [[ -S "$candidate" ]] || continue
    if DOCKER_HOST="unix://${candidate}" docker info >/dev/null 2>&1; then
      sock="$candidate"
      break
    fi
  done < <(find "${HOME}/.colima" -name docker.sock -type s 2>/dev/null | LC_ALL=C sort -u)

  if [[ -z "$sock" ]]; then
    local _paths
    _paths=$(find "${HOME}/.colima" -name docker.sock -type s 2>/dev/null | tr '\n' ' ' || true)
    echo "❌ Docker: no working Colima socket (tried every docker.sock under ~/.colima)." >&2
    echo "   Colima list: $(colima list 2>/dev/null | tr '\n' ' ' || true)" >&2
    echo "   Sockets present: ${_paths:-none}" >&2
    if [[ -n "${_paths// }" ]]; then
      echo "   Sockets exist but docker info failed on each — daemon inside the VM may be stopped." >&2
    fi
    echo "   Fix: colima stop && colima start  (or colima start --with-kubernetes)" >&2
    return 1
  fi

  export DOCKER_HOST="unix://${sock}"
  fixed_sock="$sock"

  if [[ "${OCH_COLIMA_FIX_DOCKER_CONTEXT:-1}" == "1" ]] && docker context update colima --docker "host=unix://${fixed_sock}" >/dev/null 2>&1; then
    :
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon unreachable (DOCKER_HOST=unix://${fixed_sock}). Try: colima stop && colima start" >&2
    return 1
  fi
  return 0
}

# Allow: bash scripts/lib/ensure-colima-docker-context.sh (print status; always try Colima alignment)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  OCH_FORCE_COLIMA_DOCKER=1 OCH_KUBE_CONTEXT=colima och_ensure_colima_docker_context || exit 1
  echo "✅ Docker OK — context=$(docker context show 2>/dev/null) DOCKER_HOST=${DOCKER_HOST:-<default>}"
fi
