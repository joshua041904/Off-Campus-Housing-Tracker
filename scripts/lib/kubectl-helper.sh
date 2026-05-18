#!/usr/bin/env bash
# Kubectl helper: timeouts and colima-ssh fallbacks. Do NOT set server to 6443 — pipeline uses native port only
# (6443 tunnel drops under load; see Runbook "Colima API"). Do NOT overwrite PATH — callers set shims-first.

KUBECTL_REQUEST_TIMEOUT="${KUBECTL_REQUEST_TIMEOUT:-15s}"

kctl() {
  local args=() use_validate=false
  while [[ $# -gt 0 ]]; do
    [[ "$1" == "apply" ]] && use_validate=true
    args+=("$1")
    shift
  done
  [[ "$use_validate" == "true" ]] && args+=("--validate=false")
  case "${args[0]:-}" in
    get|describe|logs|exec|port-forward|proxy|cluster-info|rollout|wait|patch|delete|create|scale)
      args=("${args[@]:0:1}" "--request-timeout=$KUBECTL_REQUEST_TIMEOUT" "${args[@]:1}");;
  esac

  if kubectl "${args[@]}" 2>/dev/null; then return 0; fi
  ctx=$(kubectl config current-context 2>/dev/null || true)
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl "${args[@]}" 2>/dev/null && return 0
  fi
  if [[ "${args[0]:-}" != "config" ]]; then
    kubectl --insecure-skip-tls-verify=true "${args[@]}" 2>/dev/null && return 0
  fi
  return 1
}
