# shellcheck shell=bash
# Aggregate source hash for Docker build context (used by bootstrap P6 to skip redundant docker builds).
# Expects REPO_ROOT to be set by the caller.
#
# Env:
#   BOOTSTRAP_SKIP_DOCKER_IMAGE_HASH_CACHE=1 — callers should skip cache reads/writes entirely.

och_docker_hash_cache_dir() {
  printf '%s' "${REPO_ROOT:?REPO_ROOT required}/.build-cache"
}

# List files that influence a service image (aligned with Dockerfiles that COPY from repo root).
och_collect_docker_build_paths() {
  local svc="$1"
  local root="${REPO_ROOT:?}"
  case "$svc" in
    webapp)
      [[ -f "$root/webapp/Dockerfile" ]] && echo "$root/webapp/Dockerfile"
      for f in package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc; do
        [[ -f "$root/$f" ]] && echo "$root/$f"
      done
      if [[ -d "$root/webapp" ]]; then
        find "$root/webapp" -type f \
          ! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/.git/*' ! -path '*/coverage/*' \
          ! -name '*.tsbuildinfo' 2>/dev/null | LC_ALL=C sort -u
      fi
      ;;
    transport-watchdog)
      if [[ -d "$root/services/transport-watchdog" ]]; then
        find "$root/services/transport-watchdog" -type f ! -path '*/node_modules/*' ! -path '*/dist/*' 2>/dev/null | LC_ALL=C sort -u
      fi
      ;;
    *)
      [[ -f "$root/services/$svc/Dockerfile" ]] && echo "$root/services/$svc/Dockerfile"
      for f in \
        scripts/docker/debian-apt-update.sh \
        scripts/docker/install-grpc-health-probe.sh \
        scripts/docker/install-bookworm-runtime-probe.sh; do
        [[ -f "$root/$f" ]] && echo "$root/$f"
      done
      for f in package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc; do
        [[ -f "$root/$f" ]] && echo "$root/$f"
      done
      [[ -d "$root/proto" ]] && find "$root/proto" -type f ! -path '*/.git/*' 2>/dev/null | LC_ALL=C sort -u
      if [[ -d "$root/services/common" ]]; then
        find "$root/services/common" -type f \
          ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.git/*' ! -path '*/coverage/*' \
          ! -name '*.tsbuildinfo' 2>/dev/null | LC_ALL=C sort -u
      fi
      if [[ -d "$root/services/$svc" ]]; then
        find "$root/services/$svc" -type f \
          ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.git/*' ! -path '*/coverage/*' \
          ! -name '*.tsbuildinfo' 2>/dev/null | LC_ALL=C sort -u
      fi
      ;;
  esac
}

och_compute_service_source_hash() {
  local svc="$1"
  local acc=""
  local p
  while IFS= read -r p; do
    [[ -n "$p" && -f "$p" ]] || continue
    acc+=$(shasum "$p" | awk '{print $1"\t"$2}')
    acc+=$'\n'
  done < <(och_collect_docker_build_paths "$svc")
  if [[ -z "${acc//[$'\t\n']/}" ]]; then
    echo "och_compute_service_source_hash: no input files for $svc" >&2
    return 1
  fi
  printf '%s' "$acc" | shasum | awk '{print $1}'
}

# If Colima is running and the VM does not yet have this image, docker save | colima load (no rebuild).
och_ensure_colima_has_image() {
  local ref="$1"
  colima status 2>/dev/null | grep -qiE 'colima is running|running' || return 0
  if colima ssh -- docker image inspect "$ref" &>/dev/null; then
    return 0
  fi
  echo "  ▶ Colima VM missing $ref — docker save | colima load (no rebuild)"
  docker save "$ref" | colima ssh -- docker load
}
