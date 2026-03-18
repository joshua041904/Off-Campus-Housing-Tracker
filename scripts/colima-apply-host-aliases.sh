#!/usr/bin/env bash
# Patch all app deployments so host.docker.internal resolves correctly for pods.
# When Docker Compose uses Colima, Postgres runs in the VM → use node InternalIP.
# When Postgres runs on Mac → use host.lima.internal. Override: HOST_GATEWAY_IP=... ./$0
#
# Undo: To revert to repo-defined hostAliases (192.168.5.2), run:
#   ./scripts/colima-undo-host-aliases.sh
# This re-applies the kustomize overlay and restores deployment specs from base YAML.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="off-campus-housing-tracker"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
info() { echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" != *"colima"* ]]; then
  say "Context is not Colima ($ctx). This script patches host.docker.internal for Colima pods."
  info "For k3d, preflight applies host aliases automatically. For Colima, switch context first."
  exit 1
fi

# Extract first IPv4 only — getent/node addresses can return IPv4+IPv6; tr -d space concatenates them
_extract_ipv4() { echo "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }
_host_ip="${HOST_GATEWAY_IP:-}"
if [[ -z "$_host_ip" ]] || ! [[ "$_host_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  _raw=""
  _raw=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)
  _host_ip=$(_extract_ipv4 "$_raw")
  if [[ -z "$_host_ip" ]] && command -v colima >/dev/null 2>&1; then
    _raw=$(colima ssh -- getent hosts host.lima.internal 2>/dev/null || true)
    _host_ip=$(_extract_ipv4 "$_raw")
  fi
  if [[ -z "$_host_ip" ]] && command -v colima >/dev/null 2>&1; then
    _raw=$(colima ssh -- ip route show default 2>/dev/null | awk '{print $3}' || true)
    _host_ip=$(_extract_ipv4 "$_raw")
  fi
  _host_ip="${_host_ip:-192.168.5.2}"
fi

say "Patching host.docker.internal -> $_host_ip for app deployments..."
for _d in auth-service api-gateway records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service; do
  if kubectl get deployment "$_d" -n "$NS" --request-timeout=5s >/dev/null 2>&1; then
    kubectl patch deployment "$_d" -n "$NS" --type=merge \
      -p "{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"$_host_ip\",\"hostnames\":[\"host.docker.internal\",\"host.lima.internal\"]}]}}}}" \
      --request-timeout=10s 2>/dev/null && info "  $_d patched" || true
  fi
done
ok "host.docker.internal -> $_host_ip (ensure docker compose up -d for Postgres/Redis)"
info "Run ./scripts/diagnose-502-and-analytics.sh to verify pod→DB connectivity"
