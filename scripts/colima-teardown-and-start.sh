#!/usr/bin/env bash
# Full Colima teardown and fresh start so kubectl/preflight/reissue work reliably.
# Use when: "Cluster not reachable" at reissue step 0b, API returns 503, or tunnel is flaky.
# Run from repo root. Establishes tunnel and waits for API server (up to TEARDOWN_API_WAIT sec).
#
# Uses --network-address by default (same setup as Runbook/docs; direct MetalLB LB IP, HTTP/3).
# Set COLIMA_NETWORK_ADDRESS=0 to start without bridged networking.
# See: docs/COLIMA_NETWORK_ADDRESS_AND_LB_IP.md, Runbook.md item 65/68

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

TEARDOWN_API_WAIT="${TEARDOWN_API_WAIT:-180}"   # Wait up to 3 min for API after start
# VM resources: 12 CPU / 16 GiB RAM / 256 GiB disk (control-plane stability). Override: COLIMA_CPU=8 COLIMA_MEMORY=8 COLIMA_DISK=100
COLIMA_CPU="${COLIMA_CPU:-12}"
COLIMA_MEMORY="${COLIMA_MEMORY:-16}"   # GiB (16 for stable control plane; was 12)
COLIMA_DISK="${COLIMA_DISK:-256}"     # GiB
COLIMA_NETWORK_ADDRESS="${COLIMA_NETWORK_ADDRESS:-1}"
# Pin k3s to match docs/NEW_CLUSTER_SETUP.md (override with COLIMA_K3S_VERSION= or empty to omit flag).
COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "Colima full teardown + start (total typically 3–6 min: stop → delete VM → start → tunnel → wait API)"
info "  VM resources: ${COLIMA_CPU} CPU, ${COLIMA_MEMORY}GiB RAM, ${COLIMA_DISK}GiB disk (set COLIMA_CPU/MEMORY/DISK to override)"
info "  Network: COLIMA_NETWORK_ADDRESS=${COLIMA_NETWORK_ADDRESS} (1 = --network-address for direct LB IP)"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Stop (may be killed by OS under memory pressure; we continue anyway)
# ---------------------------------------------------------------------------
say "Step 1/4: Stopping Colima (usually 5–15s)..."
if ! colima stop 2>&1; then
  warn "colima stop exited non-zero or was killed — continuing. Delete will tear down the VM anyway."
fi

# ---------------------------------------------------------------------------
# Step 2: Delete profile — SLOW (removes VM + disk, often 1–3 min)
# ---------------------------------------------------------------------------
say "Step 2/4: Deleting Colima profile (full teardown)..."
info "  This can take 1–3 minutes (removing VM and disk). You'll see colima output below."
_delete_start=$(date +%s)
if ! colima delete -f 2>&1; then
  warn "colima delete -f failed or was killed. Check: colima list"
  exit 1
fi
_delete_end=$(date +%s)
_delete_sec=$((_delete_end - _delete_start))
ok "Profile deleted in ${_delete_sec}s"

# ---------------------------------------------------------------------------
# Step 3: Start (1–2 min for VM + k3s) with 12 CPU / 16GiB / 256GiB for stable control plane; --network-address for same setup as Runbook
# ---------------------------------------------------------------------------
say "Step 3/4: Starting Colima with Kubernetes (${COLIMA_CPU} CPU, ${COLIMA_MEMORY}GiB, ${COLIMA_DISK}GiB; typically 1–2 min)..."
info "  k3s version: ${COLIMA_K3S_VERSION:-'(default profile — set COLIMA_K3S_VERSION to pin)'}"
_args=(--with-kubernetes --vm-type vz --cpu "$COLIMA_CPU" --memory "$COLIMA_MEMORY" --disk "$COLIMA_DISK")
[[ "$COLIMA_NETWORK_ADDRESS" == "1" ]] && _args+=(--network-address)
[[ -n "${COLIMA_K3S_VERSION:-}" ]] && _args+=(--kubernetes-version "$COLIMA_K3S_VERSION")
if ! colima start "${_args[@]}" 2>&1; then
  _fallback=(--with-kubernetes --cpu "$COLIMA_CPU" --memory "$COLIMA_MEMORY" --disk "$COLIMA_DISK")
  [[ "$COLIMA_NETWORK_ADDRESS" == "1" ]] && _fallback+=(--network-address)
  [[ -n "${COLIMA_K3S_VERSION:-}" ]] && _fallback+=(--kubernetes-version "$COLIMA_K3S_VERSION")
  colima start "${_fallback[@]}" 2>&1 || { echo "❌ colima start failed. Try: colima start --with-kubernetes --network-address --cpu $COLIMA_CPU --memory $COLIMA_MEMORY --disk $COLIMA_DISK"; exit 1; }
fi
ok "Colima started"

# Let k3s boot undisturbed (reduces 51820 race). Set POST_START_SLEEP=0 to skip.
POST_START_SLEEP="${POST_START_SLEEP:-180}"
if [[ "$POST_START_SLEEP" -gt 0 ]]; then
  info "Waiting ${POST_START_SLEEP}s for k3s to boot undisturbed (set POST_START_SLEEP=0 to skip)..."
  sleep "$POST_START_SLEEP"
fi

say "Step 4/4: Establishing tunnel 127.0.0.1:6443 and pinning kubeconfig..."
"$SCRIPT_DIR/colima-forward-6443.sh" 2>&1 || true

say "Waiting for API server (up to ${TEARDOWN_API_WAIT}s; k3s may return 503 briefly)..."
start=$(date +%s)
while true; do
  if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    ok "API server ready"
    break
  fi
  now=$(date +%s)
  if [[ $((now - start)) -ge $TEARDOWN_API_WAIT ]]; then
    warn "API server not ready after ${TEARDOWN_API_WAIT}s. Run: $REPO_ROOT/scripts/colima-api-status.sh"
    echo "  Then: colima ssh -- sudo systemctl restart k3s   # or re-run this script later"
    break
  fi
  echo "  Waiting... ($((now - start))s / ${TEARDOWN_API_WAIT}s)"
  sleep 10
done

ok "Colima ready. Re-run preflight: RUN_FULL_LOAD=0 KILL_STALE_FIRST=1 bash $REPO_ROOT/scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee preflight-full-\$(date +%Y%m%d-%H%M%S).log"
