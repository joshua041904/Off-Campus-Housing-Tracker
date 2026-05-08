#!/usr/bin/env bash
# Portable tarball: 3-broker KRaft + MetalLB manifests, cert tooling, kafka-alignment-suite,
# chaos-suite-kafka / stochastic alignment chaos, and related Makefile fragments.
#
# Does NOT ship private keys (.pem/.key under certs/ are gitignored). Use bundled scripts to generate.
# Output: $HOME/kafka-kraft-3broker-chaos-suite-bundle-<stamp>.tar.gz
#         Override: KAFKA_CHAOS_BUNDLE_DIR=/path
#         Keep prior archives: KAFKA_CHAOS_BUNDLE_KEEP_ALL=1
#
# Usage: bash scripts/package-kafka-kraft-3broker-chaos-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${KAFKA_CHAOS_BUNDLE_DIR:-$HOME}"
[[ -d "$OUT_DIR" ]] || { echo "KAFKA_CHAOS_BUNDLE_DIR not a directory: $OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="kafka-kraft-3broker-chaos-suite-bundle"
BUNDLE="$STAGE/$TOP"
mkdir -p "$BUNDLE"

copy_one() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -e "$src" ]]; then
    echo "missing: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -a "$src" "$BUNDLE/$rel"
}

copy_tree() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -d "$src" ]]; then
    echo "missing dir: $rel" >&2
    exit 1
  fi
  rm -rf "${BUNDLE:?}/$rel"
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -a "$src" "$BUNDLE/$rel"
}

# --- K8s: 3-broker KRaft + MetalLB, cert-manager CRDs, ops cron ---
copy_tree "infra/k8s/kafka-kraft-metallb"
copy_tree "infra/k8s/kafka-certs"
copy_one "infra/k8s/base/namespaces.yaml"
copy_tree "infra/k8s/kafka-ops"
copy_tree "infra/docker/kafka-alignment-cron"
copy_one "infra/k8s/base/observability/prometheus-rules-kafka-health.yaml"
copy_one ".github/workflows/kafka-cluster-verify.yml"

# --- Alignment suite + chaos orchestration ---
for rel in \
  scripts/package-kafka-kraft-3broker-chaos-bundle.sh \
  scripts/tests/kafka-alignment-suite.sh \
  scripts/run-chaos-suite.sh \
  scripts/chaos-kafka-alignment-stochastic.sh \
  scripts/chaos-metallb-kafka-lb.sh \
  scripts/chaos-kafka-partition.sh \
  scripts/chaos-node-reboot.sh \
  scripts/chaos-expired-ca.sh \
  scripts/chaos-latency.sh \
  scripts/generate-chaos-report.py \
  scripts/generate-kafka-alignment-report.py \
  scripts/requirements-kafka-alignment-report.txt \
  scripts/verify-kafka-cluster.sh \
  scripts/kafka-runtime-sync.sh \
  scripts/check-kafka-config-drift.sh \
  scripts/verify-kafka-tls-sans.sh \
  scripts/verify-kafka-kraft-advertised-listeners.sh \
  scripts/verify-kafka-no-static-advertised-env.sh \
  scripts/kafka-refresh-tls-from-lb.sh \
  scripts/kafka-ssl-from-dev-root.sh \
  scripts/ensure-dev-root-ca.sh \
  scripts/dev-generate-certs.sh \
  scripts/generate-canonical-dev-tls.sh \
  scripts/wait-for-kafka-external-lb-ips.sh \
  scripts/verify-kafka-broker-keystore-jks.sh \
  scripts/kafka-after-rollout-verify-brokers.sh \
  scripts/kafka-tls-guard.sh \
  scripts/kafka-auto-heal-inter-broker-tls.sh \
  scripts/kafka-sync-metallb.sh \
  scripts/patch-kafka-external-metallb-pinned-ips.sh \
  scripts/apply-kafka-kraft-staged.sh \
  scripts/gen-kafka-cert-crds.sh \
  scripts/verify-kafka-metallb-pin-formula.sh \
  scripts/kafka-rolling-restart.sh \
  scripts/validate-kafka-stack-contract.sh \
  scripts/validate-kafka-dns.sh \
  certs/README.txt
do
  copy_one "$rel"
done

mkdir -p "$BUNDLE/scripts/lib"
for f in \
  kafka-broker-sans.sh \
  kafka-metallb-pin-formula.sh \
  kafka-kraft-quorum-ok.sh
do
  copy_one "scripts/lib/$f"
done

# Optional shims (some scripts prepend PATH with scripts/shims).
if [[ -d "$ROOT/scripts/shims" ]]; then
  mkdir -p "$BUNDLE/scripts/shims"
  for f in "$ROOT/scripts/shims"/*; do
    [[ -f "$f" ]] || continue
    cp -a "$f" "$BUNDLE/scripts/shims/"
  done
fi

mkdir -p "$BUNDLE/make-fragments"
sed -n '417,432p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.kafka-alignment-suite.fragment"
sed -n '434,459p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.kafka-health-and-chaos-cert.fragment"
sed -n '519,521p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.apply-kafka-kraft.fragment"
sed -n '1255,1260p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.chaos-suite-kafka.fragment"

find "$BUNDLE" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true

cat > "$BUNDLE/README_BUNDLE.txt" <<'EOF'
Kafka KRaft — 3 brokers + MetalLB + alignment test suite + chaos bundle
========================================================================

What this tarball contains
--------------------------
  • infra/k8s/kafka-kraft-metallb/ — StatefulSet (replicas: 3), headless + per-broker external LB Services, RBAC, PDB, alignment exporter
  • infra/k8s/kafka-certs/ — cert-manager ClusterIssuer + per-broker Certificate CRDs + preflight Job (see README.md inside)
  • infra/k8s/kafka-ops/ — optional CronJob wiring for alignment validation
  • infra/docker/kafka-alignment-cron/ — image build context for that CronJob
  • scripts/tests/kafka-alignment-suite.sh — full alignment suite (safe default; KAFKA_ALIGNMENT_TEST_MODE=1 for destructive tests)
  • scripts/run-chaos-suite.sh + chaos-kafka-alignment-stochastic.sh (+ related chaos scripts / generate-chaos-report.py)
  • Kafka TLS / LB sync helpers: kafka-runtime-sync, kafka-refresh-tls-from-lb, verify-kafka-cluster, check-kafka-config-drift, …
  • Cert generation (no private keys in this archive):
      - scripts/dev-generate-certs.sh — local CA + leaf + optional Kafka JKS under certs/ (openssl + optional keytool)
      - scripts/ensure-dev-root-ca.sh — ensures dev-root.pem/key (may invoke pnpm reissue if present in a full repo)
      - scripts/kafka-ssl-from-dev-root.sh — broker keystore + kafka-ssl-secret from dev-root CA + MetalLB SANs
      - scripts/generate-canonical-dev-tls.sh — ordered full-stack TLS orchestration (calls additional scripts if you extend the bundle)
  • certs/README.txt — expectations and EKU notes for Kafka broker material
  • make-fragments/*.fragment — Makefile excerpts for: kafka-alignment-suite, kafka-health, apply-kafka-kraft, chaos-suite-kafka
  • .github/workflows/kafka-cluster-verify.yml — CI touchpoints for alignment script
  • prometheus-rules-kafka-health.yaml — alert hints referencing the alignment suite

Prerequisites on the target cluster
------------------------------------
  • kubectl, openssl; keytool recommended for JKS
  • MetalLB (or equivalent) with an address pool for kafka-*-external LoadBalancers
  • Namespace off-campus-housing-tracker (see infra/k8s/base/namespaces.yaml) or set HOUSING_NS consistently

Typical apply order (Colima / dev)
-----------------------------------
  1. kubectl apply -f infra/k8s/base/namespaces.yaml   # or create HOUSING_NS only
  2. Generate TLS: ./scripts/dev-generate-certs.sh   # from bundle root (creates certs/dev-root.*, etc.)
  3. ./scripts/kafka-ssl-from-dev-root.sh            # kafka-ssl-secret with SANs for 3 brokers + LB IPs when brokers exist
  4. make apply-kafka-kraft   # or: bash scripts/apply-kafka-kraft-staged.sh
  5. ./scripts/tests/kafka-alignment-suite.sh
  6. Destructive chaos (requires explicit flags):
       CHAOS_CONFIRM=1 KAFKA_ALIGNMENT_TEST_MODE=1 make chaos-suite-kafka
     or run components manually (see scripts/run-chaos-suite.sh).

Regenerate this tarball from the OCH repo:
  bash scripts/package-kafka-kraft-3broker-chaos-bundle.sh

No committed secrets. Generate keys locally; do not commit .key / .jks from certs/.
EOF

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) > "$BUNDLE/MANIFEST.txt"

OUT="$OUT_DIR/kafka-kraft-3broker-chaos-suite-bundle-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$TOP"
rm -rf "$STAGE"

if [[ "${KAFKA_CHAOS_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
  shopt -s nullglob
  for f in "$OUT_DIR"/kafka-kraft-3broker-chaos-suite-bundle-*.tar.gz; do
    [[ "$f" == "$OUT" ]] && continue
    rm -f "$f"
  done
  shopt -u nullglob
fi

echo "$OUT"
ls -lh "$OUT"
