#!/usr/bin/env bash
# Build a portable tarball of QUIC / HTTP3 capture + transport-invariant tooling for Record Platform.
# Bundled copies rewrite OCH defaults → record.test (edge hostname / SNI) and record-platform (k8s namespace).
# Output: $HOME/record-platform-quic-transport-porting-bundle-<stamp>.tar.gz (not inside the repo).
#         Override: RECORD_PLATFORM_PORTING_BUNDLE_DIR=/path/to/dir
# Usage: bash scripts/package-quic-transport-porting-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_OUT_DIR="${RECORD_PLATFORM_PORTING_BUNDLE_DIR:-$HOME}"
[[ -d "$BUNDLE_OUT_DIR" ]] || { echo "BUNDLE_OUT_DIR not a directory: $BUNDLE_OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
BUNDLE_TOP="record-platform-quic-transport-porting-bundle"
BUNDLE="$STAGE/$BUNDLE_TOP"
mkdir -p "$BUNDLE"

copy_one() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -f "$src" ]]; then
    echo "missing: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

for rel in \
  scripts/package-quic-transport-porting-bundle.sh \
  scripts/transport-study-v7b.mjs \
  schemas/transport-study-v7b.schema.json \
  scripts/run-transport-study-experiments.sh \
  scripts/test-packet-capture-standalone.sh \
  scripts/capture-quic-pcap.sh \
  scripts/verify-quic-jaeger-correlation.mjs \
  scripts/ci/verify-quic-hostname-invariant.sh \
  scripts/colima-quic-sysctl.sh \
  scripts/lib/packet-capture.sh \
  scripts/lib/packet-capture-v2.sh \
  scripts/lib/protocol-verification.sh \
  scripts/lib/grpc-http3-health.sh \
  scripts/lib/transport_validator.py \
  scripts/lib/quic_invariants_emit.py \
  scripts/lib/analyze_quic_metrics.py \
  scripts/lib/quic_loss_analyzer.py \
  scripts/requirements-transport-forensics.txt \
  infra/k8s/base/observability/prometheus-rule-quic-transport-invariant.example.yaml
do
  copy_one "$rel"
done

mkdir -p "$BUNDLE/scripts/lib/quic-forensic"
for f in "$ROOT/scripts/lib/quic-forensic"/*.sh; do
  [[ -f "$f" ]] || continue
  cp -f "$f" "$BUNDLE/scripts/lib/quic-forensic/"
done

mkdir -p "$BUNDLE/scripts/lib/quic_command_center"
for f in "$ROOT/scripts/lib/quic_command_center"/*.py; do
  [[ -f "$f" ]] || continue
  cp -f "$f" "$BUNDLE/scripts/lib/quic_command_center/"
done

mkdir -p "$BUNDLE/make-fragments"
# Anchors: SRE packet-capture target + transport-quic prove block (see package-och-preflight-transport-bundle.sh).
sed -n '959,968p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.packet-capture.fragment"
sed -n '1127,1233p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.transport-quic.fragment"

mkdir -p "$BUNDLE/docs"
grep -n "QUIC v6+v7\|PREFLIGHT_RUN_QUIC\|transport-quic-v6-v7-prove\|quic-transport-invariant" \
  "$ROOT/scripts/run-preflight-scale-and-all-suites.sh" 2>/dev/null | head -40 > "$BUNDLE/docs/preflight-quic-step-grep.txt" || true

# Record Platform defaults (hostname + namespace + example rule names); repo sources stay unchanged.
# Rewrites all bundled text that may reference OCH host/namespace (Makefile, trace JSON, Vitest, quic_* trees, etc.).
_record_platform_rewrites() {
  local d="$1"
  find "$d" -type f \( \
    -name '*.sh' -o -name '*.py' -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' \
    -o -name '*.txt' -o -name '*.fragment' -o -name '*.json' -o -name '*.mts' -o -name '*.md' -o -name 'Makefile' \
  \) ! -path '*/docs/preflight-quic-step-grep.txt' -print0 | while IFS= read -r -d '' f; do
    perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"
    perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"
    perl -pi -e 's/och-quic/record-platform-quic/g' "$f"
    perl -pi -e 's/\(OCH: record\.test/(Record Platform: record.test/g' "$f"
  done
}
_record_platform_rewrites "$BUNDLE"

cat > "$BUNDLE/README_PORTING.txt" <<'EOF'
Record Platform — QUIC transport + packet capture porting bundle
==================================================================

Defaults in this bundle (rewritten from OCH upstream):
  • Edge hostname / SNI: record.test  (override HOST / CAPTURE_EXPECTED_SNI)
  • App / workload Kubernetes namespace: record-platform  (override NS / HOUSING_NS)

Wire-level HTTP/3 / QUIC capture and transport-invariant tooling:
  Colima L1 node capture in STRICT mode, analyzers v5–v7, quic_command_center, optional Jaeger.

See MANIFEST.txt. Merge make-fragments/*.fragment into your Makefile (set REPO_ROOT / SCRIPTS).

Regenerate this tarball from the OCH repo (writes archive to $HOME by default):
  bash scripts/package-quic-transport-porting-bundle.sh
  RECORD_PLATFORM_PORTING_BUNDLE_DIR=/custom/dir bash scripts/package-quic-transport-porting-bundle.sh

No secrets. PCAPs and sslkeylog outputs are created at runtime under /tmp.
EOF

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) > "$BUNDLE/MANIFEST.txt"

OUT="$BUNDLE_OUT_DIR/record-platform-quic-transport-porting-bundle-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$BUNDLE_TOP"
rm -rf "$STAGE"
echo "$OUT"
ls -lh "$OUT"
