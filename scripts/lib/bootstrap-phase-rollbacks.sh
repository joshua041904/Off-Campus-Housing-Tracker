#!/usr/bin/env bash
# Optional rollbacks for DAG nodes (scripts/bootstrap-cluster.sh). Sourced only; not executed standalone.
# Env: REPO_ROOT, NS / HOUSING_NS (for kubectl -n where relevant). BOOTSTRAP_ROLLBACK_PREFLIGHT_KILL=1 allows E.transport pkill.

och_rollback_A_workspace() {
  echo "  ↩️  rollback A.workspace — noop (workspace artifacts are host-local; remove venv/build manually if needed)" >&2
}

och_rollback_B_crypto() {
  echo "  ↩️  rollback B.crypto — noop (certs/ are deterministic; delete certs/ manually if you must rewind)" >&2
}

och_rollback_C_infra() {
  echo "  ↩️  rollback C.infra — Colima factory reset (stop, delete -f, rm ~/.colima)" >&2
  command -v colima >/dev/null 2>&1 || return 0
  local _scripts
  _scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  bash "$_scripts/colima-factory-reset.sh" 2>/dev/null || true
}

och_rollback_C_images() {
  echo "  ↩️  rollback C.images — noop (re-run scripts/ensure-required-images.sh after host docker build)" >&2
}

och_rollback_G_app_runtime() {
  echo "  ↩️  rollback G.app_runtime — noop (workloads remain; re-run verify-app-runtime after fixing)" >&2
}

och_rollback_D_observability() {
  echo "  ↩️  rollback D.observability — best-effort delete observability stack (kustomize base)" >&2
  command -v kubectl >/dev/null 2>&1 || return 0
  local kdir="${REPO_ROOT}/infra/k8s/base/observability"
  if [[ -d "$kdir" ]] && kubectl get ns observability >/dev/null 2>&1; then
    kubectl delete -k "$kdir" --ignore-not-found --wait=false 2>/dev/null || true
  fi
}

och_rollback_F_kafka_alignment() {
  echo "  ↩️  rollback F.kafka_alignment — noop (topic/alignment state is cluster-local)" >&2
}

och_rollback_E_transport() {
  echo "  ↩️  rollback E.transport — optional preflight process kill" >&2
  if [[ "${BOOTSTRAP_ROLLBACK_PREFLIGHT_KILL:-0}" == "1" ]]; then
    pkill -f "run-preflight-scale-and-all-suites" 2>/dev/null || true
  else
    echo "     (set BOOTSTRAP_ROLLBACK_PREFLIGHT_KILL=1 to pkill run-preflight-scale-and-all-suites)" >&2
  fi
}

# Dispatch by DAG node id (e.g. C.infra).
och_bootstrap_rollback_dispatch() {
  local node="${1:?node id}"
  case "$node" in
    A.workspace) och_rollback_A_workspace ;;
    B.crypto) och_rollback_B_crypto ;;
    C.infra) och_rollback_C_infra ;;
    C.images) och_rollback_C_images ;;
    G.app_runtime) och_rollback_G_app_runtime ;;
    D.observability) och_rollback_D_observability ;;
    F.kafka_alignment) och_rollback_F_kafka_alignment ;;
    E.transport) och_rollback_E_transport ;;
    *)
      echo "  ⚠️  No rollback registered for ${node}" >&2
      return 1
      ;;
  esac
}
