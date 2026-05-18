#!/usr/bin/env bash
# Colima kubeconfig selection (source this file; do not run with bash -c alone).
#
# Invariant (cold bootstrap / local dev):
#   • In-VM /etc/rancher/k3s/k3s.yaml may correctly use guest-local:
#       server: https://127.0.0.1:<k3s-port>
#     We do not change that file.
#   • macOS host kubeconfig must NOT keep that 127.0.0.1 URL — the API is not on the host loopback.
#     Host cluster server must be host-reachable:
#       https://<colima-bridge-ip>:<same-k3s-port>
#     e.g. https://192.168.64.7:50620
#
# Resolution order for the host URL (when not using override):
#   1) Read <k3s-port> from the VM file above (sudo grep).
#   2) Bridge IP: OCH_COLIMA_HOST_IP, else parse `colima list`, else OCH_COLIMA_HOST_IP_FALLBACK (192.168.64.7).
#
# Env:
#   OCH_K8S_API_SERVER_OVERRIDE            — full URL (e.g. https://192.168.64.7:50620); wins over VM port + bridge IP.
#   OCH_COLIMA_KUBECONFIG_ALIGN_HOST_API — default 1: rewrite host kubeconfig only. Set 0 to skip (strict 127.0.0.1:6443 tunnel; see colima-forward-6443.sh).
#   OCH_COLIMA_HOST_IP                     — bridge IP for the VM (overrides colima list + fallback).
#   OCH_COLIMA_HOST_IP_FALLBACK            — default 192.168.64.7 when colima list has no ADDRESS yet.

och_colima_bridge_host_ip() {
  if [[ -n "${OCH_COLIMA_HOST_IP:-}" ]]; then
    printf '%s\n' "$OCH_COLIMA_HOST_IP"
    return 0
  fi
  local line ips ip
  if command -v colima >/dev/null 2>&1; then
    line="$(colima list 2>/dev/null | grep -iE 'Running|running' | head -1 || true)"
    ips="$(printf '%s\n' "$line" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' || true)"
    ip="$(printf '%s\n' "$ips" | grep -E '^192\.168\.(64|5)\.[0-9]+$' | head -1 || true)"
    [[ -z "$ip" ]] && ip="$(printf '%s\n' "$ips" | tail -n 1)"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi
  printf '%s\n' "${OCH_COLIMA_HOST_IP_FALLBACK:-192.168.64.7}"
}

och_colima_compute_host_api_server() {
  if [[ -n "${OCH_K8S_API_SERVER_OVERRIDE:-}" ]]; then
    printf '%s\n' "$OCH_K8S_API_SERVER_OVERRIDE"
    return 0
  fi
  command -v colima >/dev/null 2>&1 || return 1
  colima status >/dev/null 2>&1 || return 1
  colima ssh -- true >/dev/null 2>&1 || return 1

  local raw line port url host
  raw="$(colima ssh -- sh -c "sudo grep 'server:' /etc/rancher/k3s/k3s.yaml 2>/dev/null | head -1" 2>/dev/null || true)"
  raw="${raw//$'\r'/}"
  line="$raw"
  if [[ "$line" =~ server:[[:space:]]*(https?://[^[:space:]\"]+) ]]; then
    url="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  url="${url//\"/}"
  if [[ "$url" =~ ^https?://[^:/]+:([0-9]+)(/|$) ]]; then
    port="${BASH_REMATCH[1]}"
  elif [[ "$url" =~ ^https://[^/]+$ ]]; then
    port=443
  else
    return 1
  fi
  host="$(och_colima_bridge_host_ip)"
  [[ -n "$host" ]] || return 1
  printf 'https://%s:%s\n' "$host" "$port"
  return 0
}

_och_kubectl_set_cluster_server() {
  local kcfg="$1" new_server="$2"
  local ctx cluster cur
  command -v kubectl >/dev/null 2>&1 || return 1
  ctx="$(kubectl config get-contexts -o name --kubeconfig="$kcfg" 2>/dev/null | grep -i colima | head -1 || true)"
  [[ -n "$ctx" ]] || return 1
  kubectl config use-context "$ctx" --kubeconfig="$kcfg" >/dev/null 2>&1 || return 1
  cluster="$(kubectl config view --minify --kubeconfig="$kcfg" -o jsonpath='{.clusters[0].name}' 2>/dev/null || true)"
  [[ -n "$cluster" ]] || return 1
  cur="$(kubectl config view --minify --kubeconfig="$kcfg" -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
  [[ "$cur" == "$new_server" ]] && return 0
  kubectl config set-cluster "$cluster" --server="$new_server" --kubeconfig="$kcfg" >/dev/null 2>&1 || return 1
  return 0
}

och_align_colima_host_api_in_kubeconfig() {
  local kcfg="$1"
  [[ "${OCH_COLIMA_KUBECONFIG_ALIGN_HOST_API:-1}" == "0" ]] && return 0
  [[ -s "$kcfg" ]] || return 1
  if ! command -v kubectl >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v colima >/dev/null 2>&1 || ! colima status >/dev/null 2>&1; then
    return 1
  fi
  if [[ -z "${_OCH_COLIMA_HOST_API_SERVER_CACHED:-}" ]]; then
    _OCH_COLIMA_HOST_API_SERVER_CACHED="$(och_colima_compute_host_api_server)" || true
  fi
  [[ -n "${_OCH_COLIMA_HOST_API_SERVER_CACHED:-}" ]] || return 1
  _och_kubectl_set_cluster_server "$kcfg" "${_OCH_COLIMA_HOST_API_SERVER_CACHED}"
}

# Align both Colima kubeconfig paths (new + legacy) when present; export KUBECONFIG to the first existing file.
och_align_colima_kubeconfig_host_api() {
  unset _OCH_COLIMA_HOST_API_SERVER_CACHED
  local f s
  s="$(och_colima_compute_host_api_server)" || return 1
  [[ -n "$s" ]] || return 1
  for f in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
    [[ -s "$f" ]] || continue
    _och_kubectl_set_cluster_server "$f" "$s" || true
  done
  for f in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
    if [[ -s "$f" ]]; then
      export KUBECONFIG="$f"
      if kubectl config get-contexts -o name 2>/dev/null | grep -qi colima; then
        kubectl config use-context "$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1)" >/dev/null 2>&1 || true
      fi
      return 0
    fi
  done
  return 1
}

och_export_colima_kubeconfig_prefer_reachable() {
  unset _OCH_COLIMA_HOST_API_SERVER_CACHED
  local align="${OCH_COLIMA_KUBECONFIG_ALIGN_HOST_API:-1}"

  _och_try_one_colima_kubeconfig() {
    local f="$1"
    [[ -s "$f" ]] || return 1
    export KUBECONFIG="$f"
    if kubectl config get-contexts -o name 2>/dev/null | grep -qi colima; then
      local _c
      _c="$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1)"
      [[ -n "$_c" ]] && kubectl config use-context "$_c" >/dev/null 2>&1 || true
    fi
    if [[ "$align" != "0" ]]; then
      och_align_colima_host_api_in_kubeconfig "$f" || true
    fi
    if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$align" != "0" ]]; then
      unset _OCH_COLIMA_HOST_API_SERVER_CACHED
      och_align_colima_host_api_in_kubeconfig "$f" || true
      kubectl get nodes --request-timeout=15s >/dev/null 2>&1 && return 0
    fi
    return 1
  }

  local f other
  for f in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
    if _och_try_one_colima_kubeconfig "$f"; then
      if [[ "$align" != "0" ]]; then
        unset _OCH_COLIMA_HOST_API_SERVER_CACHED
        for other in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
          [[ "$other" == "$f" ]] && continue
          [[ -s "$other" ]] || continue
          och_align_colima_host_api_in_kubeconfig "$other" || true
        done
      fi
      return 0
    fi
  done

  for f in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
    if [[ -s "$f" ]]; then
      export KUBECONFIG="$f"
      if kubectl config get-contexts -o name 2>/dev/null | grep -qi colima; then
        kubectl config use-context "$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1)" >/dev/null 2>&1 || true
      fi
      if [[ "$align" != "0" ]]; then
        och_align_colima_host_api_in_kubeconfig "$f" || true
      fi
      return 0
    fi
  done
  return 1
}
