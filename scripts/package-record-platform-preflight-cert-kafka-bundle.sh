#!/usr/bin/env bash
# Record Platform tarball: run-preflight-scale-and-all-suites.sh + full scripts tree (preflight deps),
# Kafka KRaft + cert-manager manifests, kafka-contract (dist), package.json / pnpm workspace + lockfile,
# infra app-config, stub services/ for kafka stack contract TS grep, and cert README.
#
# Rewrites bundled text: off-campus-housing.test → record.test, off-campus-housing-tracker → record-platform
# (same rules as other Record porting bundles).
#
# Does NOT ship private keys under certs/. Generate with scripts/dev-generate-certs.sh or reissue flow.
#
# Output: $HOME/record-platform-och-preflight-cert-kafka-bundle-<stamp>.tar.gz
#         RECORD_PLATFORM_PREFLIGHT_CERT_BUNDLE_DIR=/path  — output directory
#         RECORD_PLATFORM_CERT_BUNDLE_KEEP_ALL=1 — keep older archives in that dir
#
# Usage: bash scripts/package-record-platform-preflight-cert-kafka-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${RECORD_PLATFORM_PREFLIGHT_CERT_BUNDLE_DIR:-$HOME}"
[[ -d "$OUT_DIR" ]] || { echo "OUT_DIR not a directory: $OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
TOP="record-platform-och-preflight-cert-kafka-bundle"
BUNDLE="$STAGE/$TOP"
mkdir -p "$BUNDLE"

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

copy_one() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -f "$src" ]]; then
    echo "missing file: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

copy_optional() {
  local rel="$1"
  [[ -f "$ROOT/$rel" ]] || return 0
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$ROOT/$rel" "$BUNDLE/$rel"
}

# Full scripts tree (preflight invokes many helpers; avoids brittle per-script file lists).
mkdir -p "$BUNDLE/scripts"
rsync -a \
  --delete \
  --exclude '__pycache__' \
  --exclude 'node_modules' \
  "$ROOT/scripts/" "$BUNDLE/scripts/"

# kafka-contract CLI (validate-kafka-stack-contract.sh, preflight 6a2b).
if [[ -d "$ROOT/tools/kafka-contract" ]]; then
  mkdir -p "$BUNDLE/tools/kafka-contract"
  rsync -a --delete --exclude 'node_modules' "$ROOT/tools/kafka-contract/" "$BUNDLE/tools/kafka-contract/"
fi

copy_tree "infra/k8s/kafka-kraft-metallb"
copy_tree "infra/k8s/kafka-certs"
copy_tree "infra/k8s/base/config"
copy_one "infra/k8s/base/namespaces.yaml"
copy_one "package.json"
copy_optional "pnpm-workspace.yaml"
copy_optional "pnpm-lock.yaml"
copy_one "certs/README.txt"

# validate-kafka-stack-contract greps services/**/*.ts — provide minimal tree (no OCH_KAFKA_DISABLED).
mkdir -p "$BUNDLE/services/__bundle_placeholder__"
echo "// record-platform bundle placeholder — extend with full services/ from OCH repo for image builds." >"$BUNDLE/services/__bundle_placeholder__/placeholder.ts"

copy_optional "docs/CERT_GENERATION_STRICT_TLS_MTLS.md"
copy_optional "docs/SECURITY_CERTS_REPOSITORY.md"
copy_optional "docs/PREFLIGHT_AND_DIAGNOSTICS.md"

copy_one "scripts/package-record-platform-preflight-cert-kafka-bundle.sh"

mkdir -p "$BUNDLE/make-fragments"
sed -n '55,56p' "$ROOT/package.json" >"$BUNDLE/make-fragments/package.json.preflight-scripts.snippet.json" 2>/dev/null || true
grep -n "preflight-and-suites\|verify:kafka" "$ROOT/package.json" | head -20 >"$BUNDLE/make-fragments/package.json.kafka-verify.snippet.txt" || true

_record_platform_rewrites() {
  local d="$1"
  find "$d" -type f \( \
    -name '*.sh' -o -name '*.py' -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' \
    -o -name '*.txt' -o -name '*.fragment' -o -name '*.json' -o -name '*.mts' -o -name '*.md' \
    -o -name '*.ts' -o -name '*.tsx' -o -name 'Makefile' -o -name 'pnpm-lock.yaml' \
  \) ! -path '*/node_modules/*' -print0 2>/dev/null | while IFS= read -r -d '' f; do
    perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"
    perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"
    perl -pi -e 's/och-quic/record-platform-quic/g' "$f"
    perl -pi -e 's/\(OCH: record\.test/(Record Platform: record.test/g' "$f"
  done
}

_record_platform_rewrites "$BUNDLE"

cat > "$BUNDLE/README_BUNDLE.txt" <<'EOF'
Record Platform — Preflight + TLS/mTLS + Kafka cert gates (EKU-aware)
======================================================================

Bundled for record.test / record-platform namespace (rewritten from OCH upstream).

Contents
--------
  • scripts/ — full tree including run-preflight-scale-and-all-suites.sh, 3-stage TLS helpers
    (reissue-ca-and-leaf-load-all-services.sh, generate-envoy-client-cert.sh, strict-tls-bootstrap.sh,
    generate-canonical-dev-tls.sh), ensure-strict-tls-mtls-preflight.sh, dev-generate-certs.sh,
    kafka-ssl-from-dev-root.sh (broker PEM/JKS with serverAuth+clientAuth EKU), verify-kafka-broker-keystore-jks.sh
    (keytool EKU parity), verify-kafka-tls-sans.sh, verify-housing-kafka-bootstrap.sh, validate-kafka-stack-contract.sh
    (static EKU template checks + JKS gate + optional kafka-contract live), kafka alignment/runtime scripts, etc.
  • tools/kafka-contract/ — Node CLI used by validate-kafka-stack-contract (dist/; run pnpm --filter kafka-contract run build if needed)
  • infra/k8s/kafka-kraft-metallb/ — 3-broker KRaft + MetalLB
  • infra/k8s/kafka-certs/ — cert-manager CRDs + preflight Job
  • infra/k8s/base/config/ — app bootstrap seeds (KAFKA_BROKER, etc.)
  • infra/k8s/base/namespaces.yaml — includes record-platform namespace after rewrite
  • package.json, pnpm-workspace.yaml, pnpm-lock.yaml — pnpm verify:kafka-bootstrap / verify:kafka-tls-sans
  • services/__bundle_placeholder__/ — minimal TS so validate-kafka-stack-contract static grep passes; replace with full services/ from OCH for image builds
  • certs/README.txt — EKU + SAN expectations (generate keys locally; do not commit)

Run preflight (from bundle root, with cluster + pnpm installed)
----------------------------------------------------------------
  export HOUSING_NS=record-platform   # matches rewrite
  pnpm install
  pnpm preflight-and-suites

Or directly:
  bash scripts/run-preflight-scale-and-all-suites.sh

EKU contract (Kafka broker)
---------------------------
  Broker signing templates must keep extendedKeyUsage = serverAuth, clientAuth (OpenSSL) and JKS must list
  both EKUs (verify-kafka-broker-keystore-jks.sh). validate-kafka-stack-contract.sh enforces static alignment
  across kafka-ssl-from-dev-root.sh, dev-generate-certs.sh, and scripts/ci/generate-kafka-ci-tls.sh when present.

Regenerate bundle from OCH repo:
  bash scripts/package-record-platform-preflight-cert-kafka-bundle.sh
EOF

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) >"$BUNDLE/MANIFEST.txt"

OUT="$OUT_DIR/${TOP}-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$TOP"
rm -rf "$STAGE"

if [[ "${RECORD_PLATFORM_CERT_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
  shopt -s nullglob
  for f in "$OUT_DIR"/record-platform-och-preflight-cert-kafka-bundle-*.tar.gz; do
    [[ "$f" == "$OUT" ]] && continue
    rm -f "$f"
  done
  shopt -u nullglob
fi

echo "$OUT"
ls -lh "$OUT"
