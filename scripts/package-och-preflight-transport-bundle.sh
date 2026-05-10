#!/usr/bin/env bash
# Two archives from one script:
#
# 1) OCH upstream (default): off-campus-housing.test / off-campus-housing-tracker unchanged.
#    Output: $HOME/och-preflight-cluster-stability-jaeger-transport-bundle-<stamp>.tar.gz
#
# 2) Record Platform porting: same file set + hostname/namespace rewrites (record.test, record-platform)
#    across Makefile, scripts, schemas, infra, quic_command_center, quic-forensic, etc.
#    RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh
#    Output: $HOME/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz
#
# Override out dir: OCH_PREFLIGHT_BUNDLE_DIR=/path
# Keep older archives: OCH_BUNDLE_KEEP_ALL=1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_OUT_DIR="${OCH_PREFLIGHT_BUNDLE_DIR:-$HOME}"
[[ -d "$BUNDLE_OUT_DIR" ]] || { echo "BUNDLE_OUT_DIR not a directory: $BUNDLE_OUT_DIR" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"

RECORD_PLATFORM_PORTING_BUNDLE="${RECORD_PLATFORM_PORTING_BUNDLE:-0}"
if [[ "$RECORD_PLATFORM_PORTING_BUNDLE" == "1" ]]; then
  BUNDLE_TOP="record-platform-och-preflight-scale-transport-v7b"
  OUT_GLOB="record-platform-och-preflight-scale-transport-v7b-*.tar.gz"
  DO_REWRITE=1
else
  BUNDLE_TOP="och-preflight-cluster-stability-jaeger-transport-bundle"
  OUT_GLOB="och-preflight-cluster-stability-jaeger-transport-bundle-*.tar.gz"
  DO_REWRITE=0
fi

BUNDLE="$STAGE/$BUNDLE_TOP"
mkdir -p "$BUNDLE"

copy_one() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -f "$src" ]]; then
    echo "missing required file: $rel" >&2
    exit 1
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

copy_optional() {
  local rel="$1"
  local src="$ROOT/$rel"
  if [[ ! -f "$src" ]]; then
    echo "optional skip (missing): $rel" >&2
    return 0
  fi
  mkdir -p "$BUNDLE/$(dirname "$rel")"
  cp -f "$src" "$BUNDLE/$rel"
}

# Record Platform: align bundled defaults with record.test / record-platform namespace.
_record_platform_rewrites() {
  local d="$1"
  find "$d" -type f \( \
    -name '*.sh' -o -name '*.py' -o -name '*.mjs' -o -name '*.yaml' -o -name '*.yml' \
    -o -name '*.txt' -o -name '*.fragment' -o -name '*.json' -o -name '*.mts' -o -name '*.md' -o -name 'Makefile' \
  \) ! -path '*/docs/preflight-transport-phase-grep.txt' -print0 | while IFS= read -r -d '' f; do
    perl -pi -e 's/off-campus-housing\.test/record.test/g' "$f"
    perl -pi -e 's/off-campus-housing-tracker/record-platform/g' "$f"
    perl -pi -e 's/och-quic/record-platform-quic/g' "$f"
    perl -pi -e 's/\(OCH: record\.test/(Record Platform: record.test/g' "$f"
  done
}

for rel in \
  Makefile \
  scripts/package-och-preflight-transport-bundle.sh \
  scripts/package-quic-transport-porting-bundle.sh \
  scripts/test-packet-capture-standalone.sh \
  scripts/capture-quic-pcap.sh \
  scripts/verify-quic-jaeger-correlation.mjs \
  scripts/transport-study-v7b.mjs \
  schemas/transport-study-v7b.schema.json \
  scripts/run-transport-study-experiments.sh \
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
  infra/k8s/base/observability/prometheus-rule-quic-transport-invariant.example.yaml \
  scripts/cluster-stability-guard.sh \
  scripts/phase-barrier.sh \
  scripts/preflight-controlled-transport-otel-prove.sh \
  scripts/run-preflight-scale-and-all-suites.sh \
  scripts/verify-jaeger-trace-flows.mjs \
  scripts/verify-jaeger-trace-all-verticals.sh \
  scripts/verify-jaeger-tracing-services.sh \
  scripts/verify-jaeger-trace-structure.sh \
  scripts/verify-jaeger-liveness.sh \
  scripts/verify-jaeger-async-verticals.sh \
  scripts/seed-jaeger-via-edge-health.sh \
  scripts/validate-jaeger-lb.sh \
  infra/k8s/base/observability/jaeger-deploy.yaml \
  infra/k8s/base/observability/kustomization.yaml \
  infra/observability/trace-flows.json \
  services/listings-service/vitest.integration.config.mts
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
sed -n '959,968p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.packet-capture.fragment"
sed -n '1127,1233p' "$ROOT/Makefile" > "$BUNDLE/make-fragments/Makefile.transport-quic.fragment"

mkdir -p "$BUNDLE/docs"
grep -nE "PREFLIGHT_TRANSPORT|transport-study|v7b|QUIC v6|transport-quic|7b|JAEGER_QUERY|cluster-stability|phase-barrier" \
  "$ROOT/scripts/run-preflight-scale-and-all-suites.sh" 2>/dev/null | head -80 > "$BUNDLE/docs/preflight-transport-phase-grep.txt" || true

copy_optional "docs/preflight-phase-barrier-contract.md"

if [[ "$DO_REWRITE" == "1" ]]; then
  _record_platform_rewrites "$BUNDLE"
  cat > "$BUNDLE/README_BUNDLE.txt" <<'EOF'
Record Platform — OCH preflight + scale suites + transport v7b (ported paths)
=============================================================================

Bundled defaults (rewritten from OCH upstream):
  • Edge hostname / SNI: record.test  (override HOST / CAPTURE_EXPECTED_SNI)
  • Kubernetes workload namespace: record-platform  (override NS / HOUSING_NS)

Same layout as the OCH upstream bundle, including:
  • scripts/lib/quic_command_center/*.py and scripts/lib/quic-forensic/*.sh (rewritten)
  • scripts/run-preflight-scale-and-all-suites.sh, transport-study-v7b.mjs, Jaeger helpers, Makefile + fragments

Regenerate:
  RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh

Extract:
  tar -xzf /path/to/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz -C /path/to/dest
EOF
else
  cat > "$BUNDLE/README_BUNDLE.txt" <<'EOF'
OCH — Preflight + cluster stability + Jaeger + QUIC / HTTP3 transport bundle (upstream paths)
===============================================================================================

This archive matches the Off-Campus-Housing-Tracker repo (no hostname/namespace rewrites).

Includes (high level):
  • Makefile (full root) + make-fragments/Makefile.packet-capture.fragment + Makefile.transport-quic.fragment
  • scripts/lib/quic_command_center/*.py + scripts/lib/quic-forensic/*.sh
  • Cluster: scripts/cluster-stability-guard.sh, scripts/phase-barrier.sh (+ docs/preflight-phase-barrier-contract.md when present upstream)
  • Preflight / transport: scripts/preflight-controlled-transport-otel-prove.sh,
    scripts/run-preflight-scale-and-all-suites.sh, docs/preflight-transport-phase-grep.txt
  • 7b load-phase contract: scripts/transport-study-v7b.mjs, schemas/transport-study-v7b.schema.json,
    scripts/run-transport-study-experiments.sh (PREFLIGHT_TRANSPORT_STUDY_REQUIRED path)
  • Jaeger: scripts/verify-jaeger-*.sh, verify-jaeger-trace-flows.mjs, seed-jaeger-via-edge-health.sh,
    validate-jaeger-lb.sh, infra/k8s/base/observability/jaeger-deploy.yaml + kustomization.yaml,
    infra/observability/trace-flows.json
  • QUIC + capture: packet-capture-v2.sh, analyzers, verify-quic-jaeger-correlation.mjs, CI hostname script,
    requirements-transport-forensics.txt, example Prometheus rule
  • Listings Vitest: services/listings-service/vitest.integration.config.mts
  • Meta: README_BUNDLE.txt, MANIFEST.txt, scripts/package-och-preflight-transport-bundle.sh

Record Platform port (record.test / record-platform everywhere in bundle):
  RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh

Regenerate (upstream):
  bash scripts/package-och-preflight-transport-bundle.sh
  OCH_PREFLIGHT_BUNDLE_DIR=/tmp bash scripts/package-och-preflight-transport-bundle.sh

Extract:
  tar -xzf /path/to/och-preflight-cluster-stability-jaeger-transport-bundle-<stamp>.tar.gz -C /path/to/dest

No secrets. PCAPs and sslkeylog outputs are created at runtime.
EOF
fi

( cd "$BUNDLE" && find . -type f | sed 's|^\./||' | sort ) > "$BUNDLE/MANIFEST.txt"

OUT="$BUNDLE_OUT_DIR/${BUNDLE_TOP}-${STAMP}.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$STAGE" "$BUNDLE_TOP"
rm -rf "$STAGE"

if [[ "${OCH_BUNDLE_KEEP_ALL:-0}" != "1" ]]; then
  shopt -s nullglob
  for f in "$BUNDLE_OUT_DIR"/$OUT_GLOB; do
    [[ "$f" == "$OUT" ]] && continue
    rm -f "$f"
  done
  shopt -u nullglob
fi

echo "$OUT"
ls -lh "$OUT"
