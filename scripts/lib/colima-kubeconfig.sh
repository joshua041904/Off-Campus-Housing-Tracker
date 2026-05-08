#!/usr/bin/env bash
# Colima kubeconfig selection (source this file; do not run with bash -c alone).
# After a Colima/k3s restart, ~/.kube/config can keep a stale 127.0.0.1:<port>.
# Prefer ~/.colima/default/kubernetes/kubeconfig (newer Colima), then legacy kubeconfig, and pick the first file whose API answers.

och_export_colima_kubeconfig_prefer_reachable() {
  local f
  for f in "${HOME}/.colima/default/kubernetes/kubeconfig" "${HOME}/.colima/default/kubeconfig"; do
    [[ -s "$f" ]] || continue
    export KUBECONFIG="$f"
    if kubectl config get-contexts -o name 2>/dev/null | grep -qi colima; then
      local _c
      _c="$(kubectl config get-contexts -o name 2>/dev/null | grep -i colima | head -1)"
      [[ -n "$_c" ]] && kubectl config use-context "$_c" >/dev/null 2>&1 || true
    fi
    if kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
      return 0
    fi
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
