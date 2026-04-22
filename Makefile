# ==============================================================================
# Off-Campus-Housing-Tracker — Unified Orchestration Makefile
# ==============================================================================
# ROLE: DEV   - local bootstrap and test flows
# ROLE: PERF  - ceiling/model/report/graph workflows
# ROLE: CI    - headless-safe and regression guard flows
# ROLE: SRE   - packet capture and strict canonical validation
#
# GNU Make runs recipes with $(SHELL) -c; Ubuntu /bin/sh is dash (no pipefail).
# Use bash so targets with set -euo pipefail behave like macOS / CI consistently.
SHELL := /usr/bin/env bash

REPO_ROOT := $(abspath .)
SCRIPTS := $(REPO_ROOT)/scripts
BENCH := $(REPO_ROOT)/bench_logs
# Adaptive linear order for bootstrap-dynamic / run-phase (optimize-bootstrap-order output; else graph topo).
BOOTSTRAP_ORDER_FILE ?= $(BENCH)/bootstrap_optimized_order.json
export BOOTSTRAP_ORDER_FILE
BOOTSTRAP_ORDER := $(shell cd "$(REPO_ROOT)" && node "$(SCRIPTS)/get-bootstrap-order.mjs" 2>/dev/null)
# Isolated venv for alignment report PNGs (avoids PEP 668 on Homebrew/system Python).
KAFKA_ALIGNMENT_REPORT_VENV := $(REPO_ROOT)/.venv-kafka-alignment-report
export PATH := $(SCRIPTS)/shims:/opt/homebrew/bin:/usr/local/bin:$(PATH)

# Strict dev-onboard: force verification gates (sub-makes inherit when dev-onboard runs).
DEV_ONBOARD_STRICT ?= 1
# Reissue: restart app Deployments after TLS secret updates (default 1). dev-onboard exports 0 so Kafka rolls before apps.
RESTART_SERVICES_AFTER_TLS ?= 1
# After Phase-0 dump restore, skip infra/db SQL in bring-up-cluster-and-infra (dev-onboard exports 1).
SKIP_BOOTSTRAP ?= 0
# Skip dump restore in bring-up-external-infra when Phase-0 already restored (dev-onboard exports 1 before make up).
SKIP_AUTO_RESTORE ?= 0
# apply-kafka-kraft: scale brokers to 0 before kafka-ssl-secret refresh (single JKS view). dev-onboard exports 1.
KAFKA_TLS_ATOMIC_BEFORE_REFRESH ?= 0
HOUSING_NS ?= off-campus-housing-tracker
# Colima+MetalLB lab: one entry point `make preflight-lab` (= preflight-strict). Jaeger: leave empty for auto-discovery
#   (kubectl port-forward to observability/jaeger ClusterIP → http://127.0.0.1:16686). Do NOT default a MetalLB-style IP —
#   Jaeger is typically ClusterIP, not LoadBalancer. Override only with a reachable query UI, e.g.:
#   PREFLIGHT_STRICT_JAEGER_QUERY_BASE=http://<jaeger-lb-ip>:16686 make preflight-lab
#   SKIP_MACOS_DEV_CA_TRUST=1 make preflight-lab     (skip macOS dev-root keychain *check*; trust CA manually once)
#   PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 make preflight-lab — step 7b: L1 capture during in-cluster k6 → transport-study-v7.json + Jaeger overlap (see scripts/run-transport-study-experiments.sh).
# Manual phase barrier: make phase-barrier PHASE_NAME=post-kafka-alignment
PREFLIGHT_STRICT_JAEGER_QUERY_BASE ?=
KAFKA_BROKER_REPLICAS ?= 3
# tls-first-time: skip kafka-ssl-from-dev-root.sh here; apply-kafka-kraft / kafka-refresh-tls-from-lb creates JKS after LB SANs exist.
TLS_FIRST_TIME_DEFER_KAFKA_JKS ?= 0
# reissue: skip Caddy rollout during tls-first-time; dev-onboard rolls Caddy after Kafka TLS guard.
REISSUE_SKIP_CADDY_ROLLOUT ?= 0
# make up: skip HTTP/3 edge probe when Caddy rollout is deferred (dev-onboard Phase 1); Phase 9 verifies edge.
SKIP_VERIFY_CURL_HTTP3 ?= 0

.DEFAULT_GOAL := menu

.PHONY: menu help setup reset verify diagnose clean-data-modeling-png generate-diagrams generate-uml generate-architecture bundle-2.1-submission generate-architecture-docs kafka-broker-status-stub db-schema-er-docs index-audit-md real-query-plan-suite up up-fast deps kubeconfig-colima cluster colima-net colima-patch-app-config-db-gateway tls-first-time trust-ca-macos verify-curl-http3 verify-http3-and-runtime verify-docker-ports recycle-postgres-infra infra-host infra-cluster \
	metallb-fix hosts-sanity ensure-edge-hosts wait-for-caddy-ip preflight-gate preflight-strict preflight-lab preflight-strict-full-matrix observability-ready validate-observability phase-barrier e2e-full-strict sslkeylog-seed ollama-note ollama-env verify-network-coherence verify-kafka-dns kafka-diagnose-broker-dns verify-kafka-bootstrap verify-kafka-cluster check-kafka-config-drift kafka-runtime-sync kafka-sync-metallb kafka-heal-inter-broker-tls kafka-alignment-suite kafka-health kafka-smoke kafka-smoke-with-health k8s-diagnose-restarts post-deploy-verify golden-snapshot chaos-suite-kafka verify-preflight-edge-routing diagnose-k6-edge cleanup-kafka-ops-pods apply-kafka-kraft kafka-refresh-tls-from-lb kafka-tls-rotate-atomic kafka-tls-guard kafka-tls-guard-remediate kafka-quorum-stable service-tls-alias-guard edge-readiness-gate rollout-och-full onboarding-kafka-preflight kafka-onboarding-reset kafka-lb-reset kafka-headless-reset kafka-clean-slate kafka-rolling-restart onboarding-edge dev dev-fast dev-verify dev-health dev-down dev-reset test-dev-cold-start test-dev-orchestrator-docker-break dev-onboard dev-onboard-hardened-reset dev-onboard-eks dev-onboard-lite ephemeral-k3s-smoke chaos-kafka-broker chaos-metallb-kafka-lb chaos-test sync-prometheus-kafka-rules colima-bridged colima-bridged-clean metallb-bring-up test test-current model summarize-ceiling strict-canonical ceiling collapse-trust collapse-messaging collapse-all \
	protocol-matrix packet-capture perf-lab perf-full generate-report graph-capacity heatmap-tail compare-run regression-guard \
	slack-report discord-report ci ci-full certify ceiling-default performance-lab-interpret performance-lab-interpret-latest performance-lab-one capacity-recommend capacity-one protocol-happiness transport-routing-hints transport-routing-hints-sync-k8s perf-lab-dashboards bundle-performance-lab-10 strict-envelope-check adaptive-pool-suggest declare-readiness shellcheck-preflight transport-lab full-edge-transport-validation endpoint-coverage collapse-smoke explain-all-dbs demo demo-network demo-full demo-k3d stack images images-all build-all-images kustomize-apply \
	deploy-dev rollouts preflight-metallb preflight-colima-metallb-edge transport-quic-v6-prove transport-quic-v7-prove transport-quic-v6-v7-prove test-e2e-integrated packet-capture-standalone certify-production \
	cluster-forensic-sweep forensic-log-sweep network-command-center deploy-monitoring-help tls-secrets-expiry-textfile \
	chaos-suite governed-chaos failure-budget resilience-menu generate-chaos-report-md \
	metrics-server-ready trust-integration-tests test-vitest-stack ensure-node20 kill-all bootstrap cold-bootstrap cold-bootstrap-timed cluster-doctor detect-drift verify-bootstrap-state verify-app-runtime validate-app-runtime-config report-app-runtime-cold-warm visualize-bootstrap save-bootstrap-timing-history optimize-bootstrap-order bootstrap-show-order bootstrap-dynamic run-phase detect-bootstrap-regression export-bootstrap-regression-prom grafana-dashboard explain-bootstrap upload-grafana-dashboard bootstrap-drift-check bootstrap-invariants-order bootstrap-invariants-dot build-all-images cold-boot-proof preflight-proof idempotency-proof full-stack-proof
preflight-cluster-stability-guard: ## Phase 0 guard: node headroom + metrics-server readiness before heavy preflight
	bash "$(SCRIPTS)/cluster-stability-guard.sh"

# Node 20.x is required for Rollup/Vitest and preflight (see .nvmrc). Fails fast — no silent drift.
.PHONY: ensure-node20
ensure-node20:
	@set -euo pipefail; v="$$(node -v 2>/dev/null || echo v0)"; echo "$$v" | grep -qE '^v20\.' || { echo "❌ Node 20.x required (.nvmrc). Got $$v — run: nvm use / fnm use"; exit 1; }

preflight-live-triage-snapshot: ## Capture immediate OOM/restart evidence (pods + jaeger/gateway/auth logs)
	kubectl get pods -A
	kubectl describe pod -n observability -l app=jaeger
	kubectl logs -n observability -l app=jaeger --tail=200
	kubectl logs -n off-campus-housing-tracker -l app=api-gateway --tail=200
	kubectl logs -n off-campus-housing-tracker -l app=auth-service --tail=200


# Default orchestration knobs for team "one-command" workflow.
UP_REQUIRE_COLIMA ?= 1
UP_METALLB_ENABLED ?= 1
# METALLB_POOL: do not default here — empty lets setup/install scripts auto-derive .240-.250 on Colima/node subnet.
# Override when needed: make cluster METALLB_POOL=10.0.2.240-10.0.2.250
UP_K6_USE_METALLB ?= 1
UP_METALLB_USE_K3D ?= 0
UP_RUN_PREFLIGHT ?= 0
UP_RUN_EVENT_LAYER ?= 1

TEST_RUN_PGBENCH ?= 0
TEST_REQUIRE_COLIMA ?= 0
TEST_METALLB_ENABLED ?= 1
TEST_K6_MESSAGING_LIMIT_FINDER ?= 1
TEST_PREFLIGHT_PERF_ARTIFACTS ?= 1
TEST_PREFLIGHT_PERF_PROTOCOL_MATRIX ?= 1
TEST_PREFLIGHT_PERF_STRICT_CANONICAL ?= 1
TEST_PREFLIGHT_PERF_FLATTEN_TO_10 ?= 1
TEST_PREFLIGHT_PERF_ENSURE_XK6_HTTP3 ?= 1

CEILING_SERVICES ?= trust,messaging,listings,booking,auth,gateway,analytics,media,event-layer
CEILING_PROTOCOLS ?= http3,http2,http1
CEILING_VUS_STEPS ?= 10,20,30,40,50,60
CEILING_DURATION ?= 60s
POOL_SIZES ?= 10,20,30,40
MIN_RECOMMENDED_POOL ?= 5
GENERATE_HTML_REPORT ?= 1
GENERATE_MD_REPORT ?= 1
REGRESSION_THRESHOLD_P95 ?= 0.15
SLACK_WEBHOOK ?=
DISCORD_WEBHOOK ?=
TARGET_IP ?=
CI_MODE ?= 0
HEADLESS ?= 0
KUBECONFIG_COLIMA ?= $(HOME)/.colima/default/kubeconfig
RESTORE_BACKUP_DIR ?= latest
# Default 1: append off-campus-housing.test → MetalLB IP via sudo when needed (set 0 for hints only).
HOSTS_AUTO ?= 1
EXTERNAL_IP ?=

# Public entrypoints (teammates): full bootstrap, health checks, Kafka nuclear reset, diagnostics.
setup: dev ## Alias: one-command local environment (make dev)
reset: kafka-clean-slate ## Alias: wipe Kafka broker data + service reset (DESTROYS PVCs)
verify: ## Kafka cluster + edge routing checks
	$(MAKE) verify-kafka-cluster
	$(MAKE) verify-preflight-edge-routing
diagnose: ## Narrower diagnostics (DNS, bootstrap, k6 edge hints)
	$(MAKE) verify-kafka-dns
	$(MAKE) verify-kafka-bootstrap
	$(MAKE) diagnose-k6-edge

clean-data-modeling-png: ## Delete diagrams/data-modeling/png/*.png (next generate-architecture recreates)
	bash "$(SCRIPTS)/diagram/clean-data-modeling-png.sh"

generate-diagrams: ## Graphviz: unified logical ER + domain + flow + poster + physical (SVG+PNG, heat overlay)
	@command -v jq >/dev/null || { echo "install jq"; exit 1; }
	@command -v dot >/dev/null || { echo "install graphviz (dot)"; exit 1; }
	"$(SCRIPTS)/diagram/generate-all.sh" "$(REPO_ROOT)/diagrams"

generate-uml: ## PlantUML (C4 + class/sequence/state) → diagrams/data-modeling/png/ (plantuml or PLANTUML_DOCKER=1)
	bash "$(SCRIPTS)/plantuml/render-all.sh"

generate-architecture: ## Fresh PNG bucket: wipe data-modeling/png, then Graphviz + PlantUML
	$(MAKE) clean-data-modeling-png
	$(MAKE) generate-diagrams
	$(MAKE) generate-uml

bundle-2.1-submission: ## §2.1 package: copy PNGs + class XMI + MANIFEST → docs/architecture-submission/2.1-architecture-diagram/
	bash "$(SCRIPTS)/architecture/bundle-2.1-submission.sh"

generate-architecture-docs: ## Diagrams + docs/architecture copies + per-service service/*.md (needs Postgres)
	@command -v jq >/dev/null || { echo "install jq"; exit 1; }
	@command -v dot >/dev/null || { echo "install graphviz (dot)"; exit 1; }
	"$(SCRIPTS)/diagram/generate-architecture-docs.sh" "$(REPO_ROOT)/diagrams"

kafka-broker-status-stub: ## Example kafka-broker-status.json for KAFKA_BROKER_STATUS_JSON / data-flow colors
	"$(SCRIPTS)/diagram/fetch-kafka-broker-status-stub.sh" "$(REPO_ROOT)/scripts/diagram/data/kafka-broker-status.local.json"

db-schema-er-docs: ## Markdown: columns, indexes, pg_settings, Mermaid ER, EXPLAIN ANALYZE
	"$(SCRIPTS)/generate-db-schema-er-and-plans.sh"

index-audit-md: ## Index definitions + idx_scan matrix → reports/index-audit-*.md
	"$(SCRIPTS)/diagram/generate-index-audit-md.sh"

real-query-plan-suite: ## Realistic EXPLAIN ANALYZE → reports/real-query-plans-*.md
	"$(SCRIPTS)/run-real-query-plan-suite.sh"

help: ## List targets and short descriptions
	@echo "Off-Campus-Housing-Tracker — common make targets"
	@echo ""
	@grep -hE '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Core:"
	@echo "  make up               Full bootstrap (cluster + infra + TLS + /etc/hosts for edge; no KRaft / no deploy-dev)"
	@echo "  make dev              scripts/dev-up.sh (orchestrator + dev-health-check + dev-state.json); make setup alias"
	@echo "  make dev-fast         dev with SKIP_BUILD=1 SKIP_CERTS=1"
	@echo "  make dev-health       Post-up gates only (/readyz, Jaeger, strict TLS, Kafka bootstrap)"
	@echo "  make dev-down         DEV_DOWN_CONFIRM=yes → delete housing ns + compose down"
	@echo "  make dev-verify       Edge + TLS + Kafka health against current context (no teardown)"
	@echo "  make dev-onboard      Legacy: Phase-0 restore path + deps + CA + tail (RESTORE_BACKUP_DIR=…); EKS → verify-only"
	@echo "  make rollout-och-full  After Kafka/TLS secret fixes: ensure cluster secrets + restart all housing apps + Caddy (ordered)"
	@echo "  make kafka-heal-inter-broker-tls  Recreate kafka-0..N-1 if CrashLoop / PKIX JKS drift (see Runbook.md)"
	@echo "  make kafka-diagnose-broker-dns  ENOTFOUND kafka-0.kafka...? (headless svc, pods, EndpointSlices)"
	@echo "  make dev-onboard-eks  EKS: verify Kafka + edge only (no MetalLB/hosts reset)"
	@echo "  make dev-onboard-lite CI-safe static checks (scripts + kustomize + client dry-run)"
	@echo "  make kafka-smoke / kafka-smoke-with-health / post-deploy-verify  Live cluster gates (see Actions: Post-deploy verify)"
	@echo "  make golden-snapshot   Rebuild all :dev images, roll everything, kafka-health + alignment suite"
	@echo "  make setup / verify / reset / diagnose  — teammate shortcuts (see help)"
	@echo "  make test             Strict canonical preflight + performance lab"
	@echo "  make test-current     Service ceiling sweep + model derivation"
	@echo "  make model            Derive model from latest protocol-comparison.csv"
	@echo "  make performance-lab-interpret CSV=<combined.csv>  Build classification/merit/report outputs"
	@echo "  make performance-lab-interpret-latest  Auto-detect latest combined CSV and build outputs"
	@echo "  make performance-lab-one  Latest ceiling run -> combined-10 + interpretation outputs"
	@echo "  make capacity-recommend  Generate pool/ingress/dashboard outputs from performance-lab"
	@echo "  make capacity-one        One command: lab + capacity + happiness + H2 hints + dashboards + 10-file bundle"
	@echo "  make explain-all-dbs     EXPLAIN ANALYZE across housing Postgres (5441–5448)"
	@echo "  make generate-diagrams        Unified logical ER + domain + flow + poster + physical (SVG+PNG)"
	@echo "  make generate-uml              PlantUML C4 + UML → diagrams/data-modeling/png/"
	@echo "  make clean-data-modeling-png   Delete diagrams/data-modeling/png/*.png only"
	@echo "  make generate-architecture     clean PNG dir, then generate-diagrams + generate-uml"
	@echo "  make bundle-2.1-submission     Copy PNGs + class XMI into docs/architecture-submission/2.1-architecture-diagram/"
	@echo "  make generate-architecture-docs  Same + sync docs/architecture + services/*.md"
	@echo "  make kafka-broker-status-stub  Example JSON for KAFKA_BROKER_STATUS_JSON (Kafka colors in data-flow)"
	@echo "  make db-schema-er-docs   Full DB schema Markdown (Mermaid + settings + indexes + EXPLAIN)"
	@echo "  make index-audit-md      Index definitions + idx_scan matrix → reports/"
	@echo "  make real-query-plan-suite  Realistic EXPLAIN plans → reports/real-query-plans-*.md"
	@echo ""
	@echo "Advanced:"
	@echo "  make collapse-trust"
	@echo "  make collapse-messaging"
	@echo "  make collapse-all"
	@echo "  make protocol-matrix"
	@echo "  make strict-canonical"
	@echo "  make packet-capture TARGET_IP=<ip>"
	@echo "  make graph-capacity"
	@echo "  make heatmap-tail"
	@echo "  make compare-run RUN1=... RUN2=..."
	@echo "  make regression-guard RUN1=... RUN2=..."
	@echo "  make ci | make ci-full"
	@echo ""
	@echo "See docs/MAKE_DEMO.md for Colima vs k3d, MetalLB, and env tuning."

menu: ## Friendly workflow menu (default target)
	@echo ""
	@echo "=============================================================="
	@echo " Off-Campus-Housing-Tracker Make Menu"
	@echo "=============================================================="
	@echo ""
	@echo "Core (most people use):"
	@echo "  make up"
	@echo "  make dev           # dev-up.sh → full stack + health (see BUILD.md)"
	@echo "  make dev-verify    # sanity existing cluster (no teardown)"
	@echo "  make dev-onboard   # legacy full stack + optional Phase-0 restore (see docs/DEV_ONBOARDING.md)"
	@echo "  make up-fast"
	@echo "  make strict-canonical"
	@echo "  make test-current"
	@echo ""
	@echo "Performance / modeling (advanced):"
	@echo "  make collapse-all"
	@echo "  make performance-lab-one"
	@echo "  make capacity-one"
	@echo "  make protocol-happiness"
	@echo "  make perf-lab-dashboards"
	@echo "  make bundle-performance-lab-10"
	@echo "  make strict-envelope-check"
	@echo "  make transport-routing-hints-sync-k8s"
	@echo "  make declare-readiness"
	@echo "  make protocol-matrix"
	@echo ""
	@echo "SRE / deep infra:"
	@echo "  make packet-capture TARGET_IP=<ip>"
	@echo "  make cluster-forensic-sweep | make forensic-log-sweep | make network-command-center"
	@echo "  make chaos-suite | make governed-chaos | make resilience-menu"
	@echo "  make demo-network"
	@echo "  make demo-k3d"
	@echo ""
	@echo "Also common:"
	@echo "  make test          -> strict-canonical + collapse-all + reports"
	@echo "  make summarize-ceiling"
	@echo ""
	@echo "Output locations:"
	@echo "  - bench_logs/ceiling/<stamp>/results.csv"
	@echo "  - bench_logs/ceiling/<stamp>/protocol-side-by-side.csv"
	@echo "  - bench_logs/ceiling/<stamp>/protocol-anomalies.csv"
	@echo "  - bench_logs/ceiling/<stamp>/service-model.json"
	@echo ""
	@echo "Use 'make help' for the full flat target list (nothing removed)."
	@echo ""

# ROLE: DEV — canonical bootstrap entrypoint
up: ## One-command cluster + infra + certs + deploy bootstrap (default: no preflight)
	$(MAKE) deps
	$(MAKE) kubeconfig-colima
	$(MAKE) cluster
	$(MAKE) colima-net
	$(MAKE) tls-first-time
	$(MAKE) trust-ca-macos
	$(MAKE) wait-for-caddy-ip
	$(MAKE) hosts-sanity
ifeq ($(SKIP_VERIFY_CURL_HTTP3),1)
	@echo "SKIP_VERIFY_CURL_HTTP3=1 — skipping verify-curl-http3 (Caddy TLS not rolled yet; use after deferred Caddy rollout)"
else
	$(MAKE) verify-curl-http3
endif
	$(MAKE) infra-host
	SKIP_CLUSTER=1 $(MAKE) infra-cluster
	$(MAKE) metallb-fix
	$(MAKE) hosts-sanity
	$(MAKE) preflight-gate
	$(MAKE) sslkeylog-seed
	$(MAKE) ollama-note
	@echo ""
	@echo "✅ make up complete."
	@echo "Next: make strict-canonical   (or make test)"

# ROLE: DEV — repeat bootstrap without re-installing toolchain/browser deps
up-fast: ## Full bootstrap flow without deps/playwright install
	$(MAKE) kubeconfig-colima
	$(MAKE) cluster
	$(MAKE) colima-net
	$(MAKE) tls-first-time
	$(MAKE) trust-ca-macos
	$(MAKE) wait-for-caddy-ip
	$(MAKE) hosts-sanity
ifeq ($(SKIP_VERIFY_CURL_HTTP3),1)
	@echo "SKIP_VERIFY_CURL_HTTP3=1 — skipping verify-curl-http3 (Caddy TLS not rolled yet; use after deferred Caddy rollout)"
else
	$(MAKE) verify-curl-http3
endif
	$(MAKE) infra-host
	SKIP_CLUSTER=1 $(MAKE) infra-cluster
	$(MAKE) metallb-fix
	$(MAKE) hosts-sanity
	$(MAKE) preflight-gate
	$(MAKE) sslkeylog-seed
	$(MAKE) ollama-note
	@echo ""
	@echo "✅ make up-fast complete."

# ROLE: DEV — fast path dependencies
deps: ## Install workspace deps + Playwright browser; ensure cluster script executable
	@set -euo pipefail; \
	if command -v fnm >/dev/null 2>&1; then eval "$$(fnm env)"; fi; \
	if ! command -v pnpm >/dev/null 2>&1; then \
	  echo "ERROR: pnpm not on PATH. Install pnpm or use fnm/nvm (e.g. brew install fnm && fnm use)."; \
	  exit 1; \
	fi; \
	cd "$(REPO_ROOT)" && pnpm install && pnpm --filter webapp exec playwright install chromium && \
	chmod +x scripts/setup-new-colima-cluster.sh scripts/ensure-edge-hosts.sh scripts/kafka-onboarding-reset.sh scripts/kafka-clean-slate.sh scripts/apply-kafka-kraft-staged.sh scripts/ensure-dev-root-ca.sh scripts/dev-onboard-zero-trust-preflight.sh scripts/kafka-refresh-tls-from-lb.sh scripts/wait-for-kafka-external-lb-ips.sh scripts/detect-k8s-environment.sh scripts/dev-onboard-local.sh scripts/dev-onboard-from-up-fast.sh scripts/dev-orchestrator.sh scripts/dev-up.sh scripts/dev-up-state-machine.sh scripts/dev-health-check.sh scripts/dev-down.sh scripts/dev-reset.sh scripts/bring-up-external-infra.sh scripts/ensure-observability-stack-ready.sh scripts/test-dev-cold-start.sh scripts/kafka-rolling-restart.sh scripts/kafka-tls-guard.sh scripts/kafka-after-rollout-verify-brokers.sh scripts/kafka-auto-heal-inter-broker-tls.sh scripts/kafka-tls-rotate-atomic.sh scripts/export-kafka-ca-metric.sh scripts/rollout-deferred-after-kafka-tls.sh scripts/kafka-quorum-stable.sh scripts/service-tls-alias-guard.sh scripts/edge-readiness-gate.sh scripts/generate-canonical-dev-tls.sh scripts/verify-kafka-no-static-advertised-env.sh scripts/check-kafka-config-drift.sh scripts/kafka-runtime-sync.sh scripts/kafka-sync-metallb.sh scripts/tests/kafka-alignment-suite.sh scripts/chaos-kafka-alignment-stochastic.sh scripts/golden-snapshot-verify.sh scripts/auth-outbox-inspect.sh scripts/auth-outbox-replay.sh scripts/wait-for-housing-service-endpoints.sh scripts/validate-cold-boot-proof.sh scripts/validate-preflight-proof.sh scripts/validate-idempotency-proof.sh scripts/validate-full-stack-proof.sh scripts/dev-kill-all.sh scripts/bootstrap-cluster.sh

# ROLE: DEV — optional kubeconfig export helper
kubeconfig-colima: ## Print/export Colima kubeconfig path for current shell
	@echo "If kubectl cannot see Colima, run:"
	@echo "  export KUBECONFIG=\"$(KUBECONFIG_COLIMA)\""

# ROLE: DEV — cluster bootstrap (Colima/k3s + MetalLB pool)
cluster: ## Start Colima+k3s + MetalLB (METALLB_POOL empty = auto .240-.250 on VM subnet)
	METALLB_POOL="$(METALLB_POOL)" "$(SCRIPTS)/setup-new-colima-cluster.sh"

# ROLE: DEV — bridged Colima + MetalLB path (historical team flow; --network-address, auto MetalLB /24)
colima-bridged: ## Start Colima+k3s with --network-address + 6443 tunnel + wait API (no VM delete)
	bash -n "$(SCRIPTS)/colima-start-k3s-bridged.sh"
	chmod +x "$(SCRIPTS)/colima-start-k3s-bridged.sh"
	"$(SCRIPTS)/colima-start-k3s-bridged.sh"

colima-bridged-clean: ## colima stop/delete + bridged start + tunnel (fresh VM; pinned k3s via COLIMA_K3S_VERSION)
	bash -n "$(SCRIPTS)/colima-start-k3s-bridged-clean.sh"
	chmod +x "$(SCRIPTS)/colima-start-k3s-bridged-clean.sh"
	"$(SCRIPTS)/colima-start-k3s-bridged-clean.sh"

metallb-bring-up: ## After colima-bridged: namespaces + MetalLB (leave METALLB_POOL unset for auto pool)
	bash -n "$(SCRIPTS)/colima-metallb-bring-up.sh"
	chmod +x "$(SCRIPTS)/colima-metallb-bring-up.sh"
	"$(SCRIPTS)/colima-metallb-bring-up.sh"

# ROLE: CI — k3s + MetalLB + trivial LoadBalancer smoke (GitHub Actions; see .github/workflows/ephemeral-cluster.yml)
ephemeral-k3s-smoke: ## Ephemeral cluster LB proof (requires kubectl + working cluster; sets METALLB_POOL if unset)
	chmod +x "$(SCRIPTS)/ci/ephemeral-k3s-converge.sh"
	bash "$(SCRIPTS)/ci/ephemeral-k3s-converge.sh"

# ROLE: DEV — verify Colima subnet vs MetalLB pool
colima-net: ## Show Colima eth0 subnet for MetalLB sanity
	colima ssh -- ip -4 addr show eth0

# ROLE: DEV — point app-config DB/Redis URLs at Colima default gateway (avoids host.docker.internal DNS)
colima-patch-app-config-db-gateway: ## Patch ConfigMap app-config: host.docker.internal → gateway IP
	bash -n "$(SCRIPTS)/colima-patch-app-config-db-host-to-gateway.sh"
	"$(SCRIPTS)/colima-patch-app-config-db-host-to-gateway.sh"

# ROLE: DEV/SRE — strict TLS + Kafka JKS chain (defer Kafka JKS with TLS_FIRST_TIME_DEFER_KAFKA_JKS=1 for dev-onboard ordering)
tls-first-time: ## Canonical TLS: reissue → Envoy client cert → strict bootstrap → optional kafka JKS (scripts/generate-canonical-dev-tls.sh)
	chmod +x "$(SCRIPTS)/generate-canonical-dev-tls.sh"
	KAFKA_SSL=1 RESTART_SERVICES=$(RESTART_SERVICES_AFTER_TLS) REISSUE_SKIP_CADDY_ROLLOUT=$(REISSUE_SKIP_CADDY_ROLLOUT) "$(SCRIPTS)/generate-canonical-dev-tls.sh"

# ROLE: DEV/SRE — KRaft headless Service: pod IP vs EndpointSlice (stale DNS detector)
verify-kafka-dns: ## Requires kubectl context; fails if kafka-N DNS slice ≠ pod IP
	bash -n "$(REPO_ROOT)/scripts/validate-kafka-dns.sh"
	"$(REPO_ROOT)/scripts/validate-kafka-dns.sh"

# ROLE: DEV/SRE — analytics-service ENOTFOUND kafka-0.kafka...? Headless svc, Ready pods, EndpointSlices, nslookup probe
kafka-diagnose-broker-dns: ## Diagnose broker DNS / ENOTFOUND (HOUSING_NS); then: verify-kafka-dns, apply-kafka-kraft
	bash -n "$(REPO_ROOT)/scripts/diagnose-kafka-broker-dns.sh"
	chmod +x "$(REPO_ROOT)/scripts/diagnose-kafka-broker-dns.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(REPO_ROOT)/scripts/diagnose-kafka-broker-dns.sh"

preflight-kafka-k8s: ## Broker props + DNS + ensure event topics (RF=3, min ISR=2); needs kubectl
	bash -n "$(REPO_ROOT)/scripts/preflight-kafka-k8s-rollout.sh"
	KAFKA_K8S_SKIP_API_HEALTH=1 "$(REPO_ROOT)/scripts/preflight-kafka-k8s-rollout.sh"

verify-kafka-bootstrap: ## ConfigMap app-config lists kafka-0..2 :9093 (three-broker client bootstrap)
	bash -n "$(REPO_ROOT)/scripts/verify-cluster-kafka-three-brokers.sh"
	"$(REPO_ROOT)/scripts/verify-cluster-kafka-three-brokers.sh"

verify-kafka-cluster: ## Full KRaft ritual: TLS SANs, advertised listeners, quorum, no leadership churn, broker API (kubectl + live brokers)
	bash -n "$(REPO_ROOT)/scripts/verify-kafka-cluster.sh"
	chmod +x "$(REPO_ROOT)/scripts/verify-kafka-cluster.sh"
	"$(REPO_ROOT)/scripts/verify-kafka-cluster.sh"

check-kafka-config-drift: ## Compare kafka-N-external LB IP to broker advertised EXTERNAL (kubectl + exec)
	bash -n "$(REPO_ROOT)/scripts/check-kafka-config-drift.sh"
	chmod +x "$(REPO_ROOT)/scripts/check-kafka-config-drift.sh"
	"$(REPO_ROOT)/scripts/check-kafka-config-drift.sh"

kafka-heal-inter-broker-tls: ## If PKIX/JKS drift or CrashLoopBackOff: delete kafka-0..N-1, wait Ready, re-verify (KAFKA_INTER_BROKER_TLS_HEAL=0 skips)
	bash -n "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh" "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh" "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"

kafka-runtime-sync: ## Gate: no LB↔advertised drift + TLS SAN vs LB (optional --remediate on script CLI)
	bash -n "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh"
	bash -n "$(REPO_ROOT)/scripts/verify-kafka-broker-keystore-jks.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	chmod +x "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh" "$(REPO_ROOT)/scripts/verify-kafka-broker-keystore-jks.sh" "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh" "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh" "$(REPO_ROOT)/scripts/kafka-tls-guard.sh" "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	"$(REPO_ROOT)/scripts/kafka-runtime-sync.sh"

kafka-sync-metallb: ## Drift-aware: verify-only if aligned; else refresh TLS from LB + rollout + verify-kafka-cluster
	bash -n "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh"
	bash -n "$(REPO_ROOT)/scripts/verify-kafka-broker-keystore-jks.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-sync-metallb.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	chmod +x "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh"
	chmod +x "$(REPO_ROOT)/scripts/verify-kafka-broker-keystore-jks.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-sync-metallb.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	chmod +x "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	"$(REPO_ROOT)/scripts/kafka-sync-metallb.sh"

kafka-alignment-report-venv: ## Venv + matplotlib for generate-kafka-alignment-report.py (PEP 668–safe)
	@test -x "$(KAFKA_ALIGNMENT_REPORT_VENV)/bin/python" || python3 -m venv "$(KAFKA_ALIGNMENT_REPORT_VENV)"
	"$(KAFKA_ALIGNMENT_REPORT_VENV)/bin/pip" install -q -r "$(REPO_ROOT)/scripts/requirements-kafka-alignment-report.txt"

kafka-alignment-suite: kafka-alignment-report-venv ## Alignment test suite (safe by default; full chaos: KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite)
	bash -n "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-refresh-tls-from-lb.sh"
	bash -n "$(REPO_ROOT)/scripts/wait-for-kafka-external-lb-ips.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	bash -n "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"
	chmod +x "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh" "$(REPO_ROOT)/scripts/kafka-refresh-tls-from-lb.sh" "$(REPO_ROOT)/scripts/wait-for-kafka-external-lb-ips.sh" "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh" "$(REPO_ROOT)/scripts/kafka-tls-guard.sh" "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh" "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	"$(KAFKA_ALIGNMENT_REPORT_VENV)/bin/python" -m py_compile "$(REPO_ROOT)/scripts/generate-kafka-alignment-report.py"
	PATH="$(KAFKA_ALIGNMENT_REPORT_VENV)/bin:$(PATH)" "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"

kafka-health-chaos-cert: ## kafka-health + destructive alignment + chaos-suite-kafka (no image rebuild; CHAOS_CONFIRM=1)
	$(MAKE) kafka-health
	KAFKA_ALIGNMENT_TEST_MODE=1 $(MAKE) kafka-alignment-suite
	CHAOS_SUITE=baseline-kafka CHAOS_KAFKA_ALIGNMENT=1 CHAOS_CONFIRM=1 KAFKA_ALIGNMENT_TEST_MODE=1 bash "$(SCRIPTS)/run-chaos-suite.sh"

kafka-health: kafka-alignment-report-venv ## verify-kafka-cluster + runtime-sync check + safe alignment (destructive cert: make kafka-health-chaos-cert; golden+chaos: GOLDEN_SNAPSHOT_CHAOS=1 make golden-snapshot)
	bash -n "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh"
	bash -n "$(REPO_ROOT)/scripts/verify-kafka-cluster.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-tls-guard.sh"
	bash -n "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	bash -n "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"
	chmod +x "$(REPO_ROOT)/scripts/ensure-dev-root-ca.sh" "$(REPO_ROOT)/scripts/verify-kafka-cluster.sh" "$(REPO_ROOT)/scripts/kafka-runtime-sync.sh" "$(REPO_ROOT)/scripts/kafka-after-rollout-verify-brokers.sh" "$(REPO_ROOT)/scripts/kafka-tls-guard.sh" "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh" "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(REPO_ROOT)/scripts/kafka-auto-heal-inter-broker-tls.sh"
	VERIFY_KAFKA_HEALTH_ONLY=0 \
	  VERIFY_KAFKA_SKIP_META_IDENTITY=0 \
	  VERIFY_KAFKA_SKIP_TLS_SANS=0 \
	  VERIFY_KAFKA_SKIP_ADVERTISED=0 \
	  VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=0 \
	  VERIFY_KAFKA_SKIP_QUORUM_GATE=0 \
	  VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=0 \
	  VERIFY_KAFKA_SKIP_BROKER_API_GATE=0 \
	  "$(REPO_ROOT)/scripts/verify-kafka-cluster.sh"
	"$(REPO_ROOT)/scripts/kafka-runtime-sync.sh" --check-only
	PATH="$(KAFKA_ALIGNMENT_REPORT_VENV)/bin:$(PATH)" KAFKA_ALIGNMENT_SKIP_TEST1_VERIFY=1 KAFKA_ALIGNMENT_TEST_MODE=0 "$(REPO_ROOT)/scripts/tests/kafka-alignment-suite.sh"

kafka-smoke: ## In-cluster curl smoke for api-gateway /healthz (needs cluster + running gateway)
	bash -n "$(SCRIPTS)/ci/smoke-api-gateway.sh"
	chmod +x "$(SCRIPTS)/ci/smoke-api-gateway.sh"
	bash "$(SCRIPTS)/ci/smoke-api-gateway.sh"

kafka-smoke-with-health: kafka-health kafka-smoke ## kafka-health then gateway smoke (full stack only)
	@true

k8s-diagnose-restarts: ## Pods with restarts: namespace events, per-container describe + logs (HOUSING_NS=…)
	bash -n "$(REPO_ROOT)/scripts/k8s-diagnose-restarts.sh"
	chmod +x "$(REPO_ROOT)/scripts/k8s-diagnose-restarts.sh"
	"$(REPO_ROOT)/scripts/k8s-diagnose-restarts.sh"

post-deploy-verify: ## kafka-health + gateway smoke + k6 + canary when workloads exist (live cluster)
	bash -n "$(SCRIPTS)/ci/post-deploy-verify.sh" "$(SCRIPTS)/ci/smoke-api-gateway.sh" "$(SCRIPTS)/ci/k6-smoke-incluster.sh" "$(SCRIPTS)/ci/canary-pod-stability.sh"
	chmod +x "$(SCRIPTS)/ci/post-deploy-verify.sh" "$(SCRIPTS)/ci/smoke-api-gateway.sh" "$(SCRIPTS)/ci/k6-smoke-incluster.sh" "$(SCRIPTS)/ci/canary-pod-stability.sh"
	bash "$(SCRIPTS)/ci/post-deploy-verify.sh"

# ROLE: SRE — Colima eth0 / MetalLB pool / node InternalIP / Kafka EXTERNAL must share one /24 (CERTIFY_SKIP_NETWORK_COHERENCE=1 to skip in certify-production)
verify-network-coherence: ## Fail on subnet split-brain (VM vs MetalLB vs Kafka advert); see scripts/verify-network-coherence.sh
	bash -n "$(REPO_ROOT)/scripts/verify-network-coherence.sh"
	chmod +x "$(REPO_ROOT)/scripts/verify-network-coherence.sh"
	"$(REPO_ROOT)/scripts/verify-network-coherence.sh"

verify-preflight-edge-routing: ## Ingress /api+/auth parity, DNS→LB, curl /api+/auth health (kubectl + DNS + certs/dev-root.pem)
	bash -n "$(REPO_ROOT)/scripts/verify-preflight-edge-routing.sh"
	chmod +x "$(REPO_ROOT)/scripts/verify-preflight-edge-routing.sh"
	"$(REPO_ROOT)/scripts/verify-preflight-edge-routing.sh"

diagnose-k6-edge: ## DNS/TLS/curl checks for off-campus-housing.test (k6 edge timeouts)
	bash -n "$(REPO_ROOT)/scripts/diagnose-k6-edge-connectivity.sh"
	bash "$(REPO_ROOT)/scripts/diagnose-k6-edge-connectivity.sh"

cleanup-kafka-ops-pods: ## Delete finished Jobs (and pods) for kafka-quorum-check / kafka-dns-auto-remediator
	bash -n "$(REPO_ROOT)/scripts/cleanup-kafka-ops-cronjob-pods.sh"
	"$(REPO_ROOT)/scripts/cleanup-kafka-ops-cronjob-pods.sh"

# ROLE: DEV — reset Kafka LB + headless Services before apply (fresh MetalLB IPs / EndpointSlices)
kafka-lb-reset: ## Delete kafka-0/1/2-external LoadBalancers only (namespace off-campus-housing-tracker)
	@for s in kafka-0-external kafka-1-external kafka-2-external; do \
	  kubectl delete svc $$s -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s; \
	done
	@echo "✅ kafka-lb-reset done"

kafka-headless-reset: ## Delete headless kafka Service + EndpointSlices (recreated by apply-kafka-kraft)
	@kubectl delete svc kafka -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s
	@kubectl delete endpoints kafka -n off-campus-housing-tracker --ignore-not-found --request-timeout=30s 2>/dev/null || true
	@kubectl delete endpointslices -n off-campus-housing-tracker -l kubernetes.io/service-name=kafka --ignore-not-found --request-timeout=30s 2>/dev/null || true
	@echo "✅ kafka-headless-reset done"

kafka-onboarding-reset: ## kafka-lb-reset + kafka-headless-reset (dev-onboard runs this before apply-kafka-kraft)
	bash "$(SCRIPTS)/kafka-onboarding-reset.sh"

# ROLE: DEV — nuclear: StatefulSet + PVCs + Service reset (KAFKA_CLEAN_SLATE_CONFIRM=YES skips prompt)
kafka-clean-slate: ## DESTROYS Kafka broker data; then run apply-kafka-kraft or dev-onboard
	bash "$(SCRIPTS)/kafka-clean-slate.sh"

# ROLE: DEV — in-cluster KRaft (3 brokers): staged Services/LB → refresh broker TLS SANs → StatefulSet
apply-kafka-kraft: ## Staged: headless + external LB svcs → wait IPs → kafka-ssl refresh → PDB + SS (KAFKA_TLS_ATOMIC_BEFORE_REFRESH=1 scales to 0 first)
	chmod +x "$(SCRIPTS)/apply-kafka-kraft-staged.sh" "$(SCRIPTS)/ensure-dev-root-ca.sh" "$(SCRIPTS)/kafka-refresh-tls-from-lb.sh" "$(SCRIPTS)/wait-for-kafka-external-lb-ips.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_TLS_ATOMIC_BEFORE_REFRESH=$(KAFKA_TLS_ATOMIC_BEFORE_REFRESH) KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) bash "$(SCRIPTS)/apply-kafka-kraft-staged.sh"

kafka-refresh-tls-from-lb: ## Regenerate kafka-ssl-secret after kafka-*-external have LB IPs (requires svcs applied)
	bash -n "$(SCRIPTS)/ensure-dev-root-ca.sh"
	chmod +x "$(SCRIPTS)/ensure-dev-root-ca.sh" "$(SCRIPTS)/kafka-refresh-tls-from-lb.sh" "$(SCRIPTS)/wait-for-kafka-external-lb-ips.sh"
	bash "$(SCRIPTS)/kafka-refresh-tls-from-lb.sh"

kafka-rolling-restart: ## Ordered delete kafka pods 2→1→0 with verify-kafka-cluster between (maintenance)
	chmod +x "$(SCRIPTS)/kafka-rolling-restart.sh"
	bash "$(SCRIPTS)/kafka-rolling-restart.sh"

kafka-tls-guard: ## Mounted CA + JKS uniformity across brokers, och-kafka CA, logs, verify-kafka-cluster (fail-fast)
	chmod +x "$(SCRIPTS)/kafka-tls-guard.sh"
	KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-tls-guard.sh"

kafka-tls-rotate-atomic: ## Scale Kafka 0 → kafka-refresh-tls-from-lb → scale back → kafka-tls-guard (JKS atomicity)
	chmod +x "$(SCRIPTS)/kafka-tls-rotate-atomic.sh" "$(SCRIPTS)/ensure-dev-root-ca.sh" "$(SCRIPTS)/kafka-refresh-tls-from-lb.sh" "$(SCRIPTS)/wait-for-kafka-external-lb-ips.sh" "$(SCRIPTS)/kafka-tls-guard.sh"
	KAFKA_BROKER_REPLICAS=$(KAFKA_BROKER_REPLICAS) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-tls-rotate-atomic.sh"

kafka-tls-guard-remediate: ## Recovery from PKIX/JKS drift: atomic rotate + full guard
	$(MAKE) kafka-tls-rotate-atomic

kafka-quorum-stable: ## Gate: no QuorumController "leader is (none)" in kafka-0 logs for KAFKA_QUORUM_STABLE_WINDOW_SEC (default 30s)
	chmod +x "$(SCRIPTS)/kafka-quorum-stable.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-quorum-stable.sh"

service-tls-alias-guard: ## Fail if service-tls vs och-service-tls ca.crt fingerprints differ
	chmod +x "$(SCRIPTS)/service-tls-alias-guard.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/service-tls-alias-guard.sh"

edge-readiness-gate: ## MetalLB IP on caddy-h3 + in-pod Caddy + api-gateway /healthz HTTP 200
	chmod +x "$(SCRIPTS)/edge-readiness-gate.sh"
	NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/edge-readiness-gate.sh"

# Refresh Kafka TLS alias + ordered restart of every housing Deployment and caddy-h3 (picks up Secret mounts).
rollout-och-full: ## ensure-housing-cluster-secrets then rollout-deferred-after-kafka-tls; skip secrets: SKIP_ENSURE_CLUSTER_SECRETS=1
	chmod +x "$(SCRIPTS)/ensure-housing-cluster-secrets.sh" "$(SCRIPTS)/rollout-deferred-after-kafka-tls.sh" "$(SCRIPTS)/rollout-restart-och-full-stack.sh"
	NS_ING=$(NS_ING) HOUSING_NS=$(HOUSING_NS) OCH_ROLLOUT_STATUS_TIMEOUT=$(OCH_ROLLOUT_STATUS_TIMEOUT) SKIP_ENSURE_CLUSTER_SECRETS=$(SKIP_ENSURE_CLUSTER_SECRETS) bash "$(SCRIPTS)/rollout-restart-och-full-stack.sh"

# DESTRUCTIVE: wipes Kafka; requires existing cluster + ingress NS. Does not run make up or Docker.
dev-onboard-hardened-reset: ## Kafka clean slate → canonical TLS reissue-only → ensure secrets → apply-kafka → guards → housing rollouts
	@echo "⚠️  dev-onboard-hardened-reset destroys Kafka broker data (KAFKA_CLEAN_SLATE_CONFIRM=YES)"
	chmod +x "$(SCRIPTS)/kafka-clean-slate.sh" "$(SCRIPTS)/generate-canonical-dev-tls.sh" "$(SCRIPTS)/ensure-housing-cluster-secrets.sh" "$(SCRIPTS)/kafka-quorum-stable.sh" "$(SCRIPTS)/service-tls-alias-guard.sh" "$(SCRIPTS)/rollout-deferred-after-kafka-tls.sh"
	KAFKA_CLEAN_SLATE_CONFIRM=YES bash "$(SCRIPTS)/kafka-clean-slate.sh"
	CANONICAL_TLS_REISSUE_ONLY=1 KAFKA_SSL=1 RESTART_SERVICES=0 REISSUE_SKIP_CADDY_ROLLOUT=0 "$(SCRIPTS)/generate-canonical-dev-tls.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/ensure-housing-cluster-secrets.sh"
	HOUSING_NS=$(HOUSING_NS) KAFKA_TLS_ATOMIC_BEFORE_REFRESH=$(KAFKA_TLS_ATOMIC_BEFORE_REFRESH) $(MAKE) apply-kafka-kraft
	$(MAKE) kafka-tls-guard
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/service-tls-alias-guard.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/kafka-quorum-stable.sh"
	HOUSING_NS=$(HOUSING_NS) bash "$(SCRIPTS)/rollout-deferred-after-kafka-tls.sh"
	@echo "✅ dev-onboard-hardened-reset complete"

# ROLE: DEV — after KRaft pods Ready: DNS slice check, topic preflight, bootstrap string vs kafka-0..2
onboarding-kafka-preflight: ## Stale job cleanup + verify-kafka-dns + preflight-kafka-k8s + verify-kafka-bootstrap
	$(MAKE) cleanup-kafka-ops-pods
	$(MAKE) verify-kafka-dns
	$(MAKE) preflight-kafka-k8s
	$(MAKE) verify-kafka-bootstrap

# ROLE: DEV — wait until Caddy has MetalLB IP (avoids race before strict ensure-edge-hosts)
wait-for-caddy-ip: ## Poll caddy-h3 EXTERNAL-IP up to ~120s (ingress-nginx)
	@echo "Waiting for caddy-h3 LoadBalancer IP (ingress-nginx)..."
	@i=0; \
	while [ $$i -lt 60 ]; do \
	  ip=$$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null | tr -d '\r'); \
	  if [ -n "$$ip" ]; then echo "✅ caddy-h3 LoadBalancer IP: $$ip"; exit 0; fi; \
	  i=$$((i + 1)); sleep 2; \
	done; \
	echo "❌ Timed out waiting for caddy-h3 EXTERNAL-IP (~120s). Check: kubectl -n ingress-nginx get svc caddy-h3"; \
	exit 1

# ROLE: DEV — after deploy-dev (Caddy/ingress up): curl / API health via off-campus-housing.test
onboarding-edge: ## verify-preflight-edge-routing (MetalLB + hosts + TLS)
	$(MAKE) verify-preflight-edge-routing

# ROLE: DEV — deterministic local onboard (EKS: dev-onboard-eks). Wrapper: scripts/dev-onboard-local.sh (set -euo pipefail).
# Local path: Phase 0.25 deps + 0.5 dev-root CA → up-fast → Kafka apply → och-kafka-ssl-secret sync+verify → … (see script header).
# ROLE: DEV — canonical one-liner: Colima + Compose infra + certs + images + same tail as dev-onboard (scripts/dev-orchestrator.sh)
dev: ensure-node20 ## OCH one-command dev up (scripts/dev-up.sh → orchestrator + health + bench_logs/dev-state.json)
	@chmod +x "$(SCRIPTS)/dev-up.sh" "$(SCRIPTS)/dev-orchestrator.sh" "$(SCRIPTS)/dev-health-check.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/dev-up.sh"

dev-fast: ensure-node20 ## Same as dev but skip image rebuild + cert phase (still runs health)
	@chmod +x "$(SCRIPTS)/dev-up.sh" "$(SCRIPTS)/dev-orchestrator.sh" "$(SCRIPTS)/dev-health-check.sh" && cd "$(REPO_ROOT)" && SKIP_BUILD=1 SKIP_CERTS=1 bash "$(SCRIPTS)/dev-up.sh"

dev-health: ## Run post-up checks only (Compose, /readyz, Jaeger, strict TLS preflight, Kafka bootstrap)
	@chmod +x "$(SCRIPTS)/dev-health-check.sh" && bash "$(SCRIPTS)/dev-health-check.sh"

dev-down: ## Delete housing namespace + docker compose down (DEV_DOWN_CONFIRM=yes)
	@chmod +x "$(SCRIPTS)/dev-down.sh" && bash "$(SCRIPTS)/dev-down.sh"

dev-reset: ## dev-down + compose down -v (+ optional DEV_RESET_CLEAR_BENCH_LOGS=1); DEV_RESET_CONFIRM=yes
	@chmod +x "$(SCRIPTS)/dev-reset.sh" "$(SCRIPTS)/dev-down.sh" && bash "$(SCRIPTS)/dev-reset.sh"

kill-all: ## pkill proof/preflight jobs only (scripts/dev-kill-all.sh — no Colima; use make bootstrap for VM reset)
	@chmod +x "$(SCRIPTS)/dev-kill-all.sh" && bash "$(SCRIPTS)/dev-kill-all.sh"

cluster-doctor: ensure-node20 ## Live health + drift + DAG; writes bench_logs/cluster-doctor.json (CLUSTER_DOCTOR_STRICT=1 → exit if score < 95)
	@chmod +x "$(SCRIPTS)/cluster_health_dag.py" 2>/dev/null || true
	@cd "$(REPO_ROOT)" && \
	if [ "$${CLUSTER_DOCTOR_STRICT:-}" = "1" ]; then \
	  python3 "$(SCRIPTS)/cluster_health_dag.py" doctor --repo "$(REPO_ROOT)" --strict; \
	else \
	  python3 "$(SCRIPTS)/cluster_health_dag.py" doctor --repo "$(REPO_ROOT)"; \
	fi

detect-drift: ensure-node20 ## Historical drift vs bootstrap-artifact.json → bench_logs/drift-detection.json (exit 1 if drift). DRIFT_WARN_ONLY=1 → always exit 0
	@cd "$(REPO_ROOT)" && python3 "$(SCRIPTS)/cluster_health_dag.py" drift --repo "$(REPO_ROOT)"

verify-bootstrap-state: ensure-node20 ## Machine-verifiable bootstrap contract (JSON). VERIFY_BOOTSTRAP_CONTEXT=post-bootstrap|ci|… Default post-bootstrap; writes bench_logs/bootstrap-state-verify-latest.json
	@cd "$(REPO_ROOT)" && HOUSING_NS="$(HOUSING_NS)" VERIFY_BOOTSTRAP_CONTEXT="$${VERIFY_BOOTSTRAP_CONTEXT:-post-bootstrap}" node "$(SCRIPTS)/verify-bootstrap-state.mjs" --json-out "$(BENCH)/bootstrap-state-verify-latest.json"

verify-app-runtime: ensure-node20 ## DAG G.app_runtime: parallel rollout + /healthz; VERIFY_APP_RUNTIME_MODE=ci fail-fast; VERIFY_APP_RUNTIME_PROM_OUT (.prom + latency percentiles); VERIFY_APP_RUNTIME_CONFIG; HOUSING_NS
	@chmod +x "$(SCRIPTS)/verify-app-runtime.sh" && cd "$(REPO_ROOT)" && HOUSING_NS="$(HOUSING_NS)" NAMESPACE="$(HOUSING_NS)" bash "$(SCRIPTS)/verify-app-runtime.sh"

validate-app-runtime-config: ensure-node20 ## Assert G.app_runtime in graph + non-empty infra/app_runtime_services.json
	@node "$(SCRIPTS)/validate-runtime-config.mjs"

report-app-runtime-cold-warm: ensure-node20 ## Latest cold vs warm JSONL history → stdout; VERIFY_APP_RUNTIME_HISTORY; optional --json-out path
	@node "$(SCRIPTS)/report-app-runtime-cold-warm.mjs" $(ARGS)

visualize-bootstrap: ensure-node20 ## CLI colors + Prometheus slice metrics + bench_logs/bootstrap_dag.html (graph + progress + timings)
	@chmod +x "$(SCRIPTS)/visualize-bootstrap.sh" "$(SCRIPTS)/export-bootstrap-phase-metrics.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/visualize-bootstrap.sh" && bash "$(SCRIPTS)/export-bootstrap-phase-metrics.sh" && node "$(SCRIPTS)/render-bootstrap-dag-html.mjs" --html-out "$(BENCH)/bootstrap_dag.html"

save-bootstrap-timing-history: ## Copy bootstrap_phase_timings.json → bench_logs/historical_timings/run-*.json (VERIFY_BOOTSTRAP_TIMING_* overrides)
	@chmod +x "$(SCRIPTS)/save-timing-history.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/save-timing-history.sh"

optimize-bootstrap-order: ensure-node20 ## Historical timings → weighted topo suggestion in bench_logs/bootstrap_optimized_order.json (ARGS=--json for stdout)
	@node "$(SCRIPTS)/optimize-bootstrap-order.mjs" $(ARGS)

bootstrap-show-order: ensure-node20 ## Print BOOTSTRAP_ORDER (optimized file if present, else graph topo)
	@echo "$(BOOTSTRAP_ORDER)"

bootstrap-dynamic: ensure-node20 ## Validate+print each phase in BOOTSTRAP_ORDER (extend scripts/run-phase.sh for real work)
	@echo "Using BOOTSTRAP_ORDER_FILE=$(BOOTSTRAP_ORDER_FILE)"
	@echo "Order: $(BOOTSTRAP_ORDER)"
	@for phase in $(BOOTSTRAP_ORDER); do \
	  $(MAKE) run-phase PHASE=$$phase || exit 1; \
	done

run-phase: ensure-node20 ## scripts/run-phase.sh — requires PHASE=A.workspace (BOOTSTRAP_ORDER_FILE overrides)
	@test -n "$(PHASE)" || { echo "usage: make run-phase PHASE=A.workspace" >&2; exit 2; }
	@chmod +x "$(SCRIPTS)/run-phase.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/run-phase.sh" "$(PHASE)"

detect-bootstrap-regression: ensure-node20 ## Current timings vs historical p95 → bench_logs/bootstrap_regression_report.json (FAIL_ON_REGRESSION=1 exits 1)
	@node "$(SCRIPTS)/detect-bootstrap-regression.mjs"

export-bootstrap-regression-prom: ## bench_logs/bootstrap_regression_report.json → bench_logs/bootstrap_regression.prom
	@chmod +x "$(SCRIPTS)/export-bootstrap-regression-prom.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/export-bootstrap-regression-prom.sh"

grafana-dashboard: ensure-node20 ## bench_logs/bootstrap_grafana_dashboard.json (bootstrap + app_runtime + regression PromQL)
	@node "$(SCRIPTS)/generate-grafana-dashboard.mjs"

explain-bootstrap: ensure-node20 ## Heuristic failure summary → bench_logs/bootstrap_failure_summary.{json,txt}
	@node "$(SCRIPTS)/explain-bootstrap-failure.mjs"

upload-grafana-dashboard: ensure-node20 ## POST dashboard JSON to Grafana (GRAFANA_URL + GRAFANA_API_KEY; optional BOOTSTRAP_GRAFANA_DASHBOARD_OUT path)
	@node "$(SCRIPTS)/upload-grafana-dashboard.mjs" $(ARGS)

bootstrap-drift-check: ensure-node20 ## verify-bootstrap-state (drift) + bench_logs/drift-report-*.json + bootstrap_drift.prom (VERIFY_BOOTSTRAP_STATE_SKIP=1 skips)
	@chmod +x "$(SCRIPTS)/bootstrap-drift-detector.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/bootstrap-drift-detector.sh"

bootstrap-invariants-order: ensure-node20 ## Topological order from infra/bootstrap_invariants.graph.json → bench_logs/bootstrap_allowed_order.json
	@node "$(SCRIPTS)/derive-bootstrap-order.mjs" --json-out "$(BENCH)/bootstrap_allowed_order.json"

bootstrap-invariants-dot: ensure-node20 ## Regenerate infra/bootstrap_invariants.dot (Graphviz) from the invariant DAG
	@node "$(SCRIPTS)/derive-bootstrap-order.mjs" --write-dot "$(REPO_ROOT)/infra/bootstrap_invariants.dot"

bootstrap: ensure-node20 ## Bootstrap v2: kill jobs + Colima reset + host/kube/Compose/TLS/images/deploy/artifact (BOOTSTRAP_CONFIRM=yes; BOOTSTRAP_FULL_WIPE=1 optional)
	@echo "Destructive cluster reset. Run:  BOOTSTRAP_CONFIRM=yes make bootstrap  (optional: BOOTSTRAP_FULL_WIPE=1 BOOTSTRAP_COMPOSE_DOWN=1 BOOTSTRAP_PRUNE_IMAGES=1 RESTORE_BACKUP_DIR=…)"
	@chmod +x "$(SCRIPTS)/bootstrap-cluster.sh" "$(SCRIPTS)/dev-kill-all.sh" "$(SCRIPTS)/bring-up-external-infra.sh" "$(SCRIPTS)/restore-external-postgres-from-backup.sh" "$(SCRIPTS)/strict-tls-bootstrap.sh" "$(SCRIPTS)/ensure-housing-cluster-secrets.sh" "$(SCRIPTS)/deploy-dev.sh" "$(SCRIPTS)/wait-for-housing-service-endpoints.sh" "$(SCRIPTS)/rollout-caddy.sh" "$(SCRIPTS)/verify-app-runtime.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/bootstrap-cluster.sh"

cold-bootstrap: ensure-node20 ## Full cold lab: pnpm install+build → Colima/bootstrap → inspect + cluster-doctor + Grafana JSON + failure summary (TTY: yes; CI: COLD_BOOTSTRAP_CONFIRM=yes). Restore: auto latest if backups/all-* exist
	@echo "cold-bootstrap: interactive confirm on a TTY, or set COLD_BOOTSTRAP_CONFIRM=yes (non-interactive / CI)."
	@echo "Disk TLS: bootstrap-cluster P1c runs DEV_CERTS_ENSURE_ONLY=1 dev-generate-certs.sh (CA + edge leaf + Kafka material if missing). BOOTSTRAP_SKIP_LOCAL_CRYPTO_INVARIANT=1 skips (not recommended)."
	@echo "Workspace: kafka-alignment-report-venv (matplotlib), then pnpm install --frozen-lockfile + pnpm run build, then dist check. COLD_BOOTSTRAP_SKIP_WORKSPACE_BUILD=1 skips pnpm but still runs venv first + requires tools/kafka-contract/dist/index.js."
	@echo "Restore: if RESTORE_BACKUP_DIR is unset and backups/all-8-* or backups/all-7-* exist → latest; if none → empty DBs. RESTORE_BACKUP_DIR=off skips restore. Pin: RESTORE_BACKUP_DIR=backups/all-8-<stamp>"
	@echo "Skip schema gate: BOOTSTRAP_SKIP_DB_SCHEMA_INSPECT=1"
	@echo "Contract JSON: verify-bootstrap-state at end (skip: VERIFY_BOOTSTRAP_STATE_SKIP=1). Drift: make bootstrap-drift-check"
	@echo "Edge transport: post-bootstrap runs UDP 443/nodePort invariant on caddy-h3; VERIFY_BOOTSTRAP_HTTP3_EDGE=1 (default here) runs scripts/verify-http3-and-runtime.mjs. Skip edge script: VERIFY_BOOTSTRAP_HTTP3_EDGE=0. Skip curl inside it: VERIFY_HTTP3_SKIP_CURL=1. Skip UDP invariant: VERIFY_BOOTSTRAP_SKIP_CADDY_UDP_NODEPORT_CHECK=1."
	@echo "Timing regression gate runs inside bootstrap-cluster (before timing snapshot): FAIL_ON_REGRESSION=1 REGRESSION_THRESHOLD=1.2 … (needs ≥3 files in bench_logs/historical_timings/; skip: BOOTSTRAP_SKIP_REGRESSION_CHECK=1)."
	@echo "After success: Grafana dashboard JSON + heuristic failure summary (skip: COLD_BOOTSTRAP_SKIP_OBSERVABILITY_ARTIFACTS=1)."
	@set -euo pipefail; cd "$(REPO_ROOT)"; \
	if [ "$${COLD_BOOTSTRAP_CONFIRM:-}" = "yes" ]; then :; \
	elif [ -t 0 ]; then \
	  printf 'Destructive: Colima VM will be deleted and the stack rebuilt. Type yes to continue: '; \
	  read -r _cba || exit 2; \
	  [ "$$_cba" = "yes" ] || { echo "Aborted."; exit 2; }; \
	else \
	  echo "❌ Non-interactive shell: set COLD_BOOTSTRAP_CONFIRM=yes (wipes Colima + full bootstrap)."; exit 2; \
	fi; \
	_rb="$${RESTORE_BACKUP_DIR:-}"; \
	case "$$_rb" in \
	  off|no|skip|OFF|NO|SKIP) export RESTORE_BACKUP_DIR=; echo "RESTORE_BACKUP_DIR disabled — no dump restore." ;; \
	  "") \
	    if compgen -G "backups/all-8-*" >/dev/null 2>&1 || compgen -G "backups/all-7-*" >/dev/null 2>&1; then \
	      export RESTORE_BACKUP_DIR=latest; echo "Using RESTORE_BACKUP_DIR=latest (newest backups/all-8-* or all-7-*)."; \
	    else \
	      export RESTORE_BACKUP_DIR=; echo "No backups/all-* — Postgres starts without dump restore."; \
	    fi ;; \
	  *) export RESTORE_BACKUP_DIR="$$_rb"; echo "Using RESTORE_BACKUP_DIR=$$RESTORE_BACKUP_DIR" ;; \
	esac; \
	case "$${RESTORE_BACKUP_DIR:-}" in \
	  ""|latest|off|no|skip|OFF|NO|SKIP) : ;; \
	  *) \
	    if [ ! -d "$${RESTORE_BACKUP_DIR}" ]; then \
	      echo "❌ RESTORE_BACKUP_DIR is not a directory (cwd: $$(pwd)): $${RESTORE_BACKUP_DIR}"; exit 1; \
	    fi ;; \
	esac; \
	node "$(SCRIPTS)/derive-bootstrap-order.mjs" --json-out "$(REPO_ROOT)/bench_logs/bootstrap_allowed_order.json" --write-dot "$(REPO_ROOT)/infra/bootstrap_invariants.dot" 2>/dev/null || true; \
	echo "=== Workspace bootstrap invariant (Step 1: matplotlib venv → Step 2: pnpm install + build) ==="; \
	if [ "$${COLD_BOOTSTRAP_SKIP_WORKSPACE_BUILD:-0}" != "1" ]; then \
	  $(MAKE) kafka-alignment-report-venv || { echo "❌ kafka-alignment-report-venv failed (matplotlib for alignment PNGs)"; exit 1; }; \
	  command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm required on PATH"; exit 1; }; \
	  pnpm install --frozen-lockfile || { echo "❌ pnpm install --frozen-lockfile failed"; exit 1; }; \
	  pnpm run build || { echo "❌ pnpm run build failed"; exit 1; }; \
	  test -s tools/kafka-contract/dist/index.js || { echo "❌ tools/kafka-contract/dist/index.js missing after workspace build"; exit 1; }; \
	  echo "✅ workspace invariant OK"; \
	else \
	  echo "ℹ️  COLD_BOOTSTRAP_SKIP_WORKSPACE_BUILD=1 — skipping pnpm install/build"; \
	  $(MAKE) kafka-alignment-report-venv || { echo "❌ kafka-alignment-report-venv failed"; exit 1; }; \
	  test -s tools/kafka-contract/dist/index.js || { echo "❌ tools/kafka-contract/dist/index.js required (omit skip or run pnpm install && pnpm run build)"; exit 1; }; \
	fi; \
	node "$(SCRIPTS)/bootstrap-phase-guard.mjs" --graph "$(REPO_ROOT)/infra/bootstrap_invariants.graph.json" --progress "$(REPO_ROOT)/bench_logs/bootstrap_state_progress.json" --reset || { echo "❌ bootstrap-phase-guard --reset failed"; exit 1; }; \
	node "$(SCRIPTS)/bootstrap-phase-guard.mjs" --graph "$(REPO_ROOT)/infra/bootstrap_invariants.graph.json" --progress "$(REPO_ROOT)/bench_logs/bootstrap_state_progress.json" --complete A.workspace || { echo "❌ bootstrap-phase-guard --complete A.workspace failed"; exit 1; }; \
	VERIFY_APP_RUNTIME_PHASE=cold BOOTSTRAP_CONFIRM=yes BOOTSTRAP_FULL_WIPE=1 RESTORE_BACKUP_DIR="$${RESTORE_BACKUP_DIR:-}" $(MAKE) bootstrap; \
	if [ "$${BOOTSTRAP_SKIP_DB_SCHEMA_INSPECT:-0}" = "1" ]; then \
	  echo "ℹ️  BOOTSTRAP_SKIP_DB_SCHEMA_INSPECT=1 — skipping inspect-external-db-schemas.sh"; \
	else \
	  chmod +x "$(SCRIPTS)/inspect-external-db-schemas.sh" && bash "$(SCRIPTS)/inspect-external-db-schemas.sh" bench_logs; \
	fi; \
	$(MAKE) cluster-doctor; \
	if [ "$${VERIFY_BOOTSTRAP_STATE_SKIP:-0}" != "1" ]; then \
	  echo "=== verify-bootstrap-state (post-bootstrap contract + edge HTTP/3 checks) ==="; \
	  HOUSING_NS="$(HOUSING_NS)" \
	  VERIFY_BOOTSTRAP_CONTEXT=post-bootstrap \
	  VERIFY_BOOTSTRAP_HTTP3_EDGE="$${VERIFY_BOOTSTRAP_HTTP3_EDGE:-1}" \
	  node "$(SCRIPTS)/verify-bootstrap-state.mjs" --json-out "$(REPO_ROOT)/bench_logs/bootstrap-state-verify-$$(date +%Y%m%d-%H%M%S).json" || exit 1; \
	  echo "✅ verify-bootstrap-state (post-bootstrap) OK"; \
	else \
	  echo "ℹ️  VERIFY_BOOTSTRAP_STATE_SKIP=1 — skipping verify-bootstrap-state.mjs"; \
	fi; \
	if [ "$${COLD_BOOTSTRAP_SKIP_OBSERVABILITY_ARTIFACTS:-0}" != "1" ]; then \
	  echo "=== Grafana dashboard + bootstrap failure summary (bench_logs) ==="; \
	  node "$(SCRIPTS)/generate-grafana-dashboard.mjs" || echo "⚠️  generate-grafana-dashboard.mjs failed (non-fatal)"; \
	  node "$(SCRIPTS)/explain-bootstrap-failure.mjs" || echo "⚠️  explain-bootstrap-failure.mjs failed (non-fatal)"; \
	  echo "✅ observability artifacts refreshed (bootstrap_grafana_dashboard.json, bootstrap_failure_summary.*)"; \
	else \
	  echo "ℹ️  COLD_BOOTSTRAP_SKIP_OBSERVABILITY_ARTIFACTS=1 — skipping Grafana JSON + failure summary"; \
	fi

cold-bootstrap-timed: ensure-node20 ## Same as cold-bootstrap but writes bench_logs/cold-bootstrap-last-timing.json (duration + exit code)
	@chmod +x "$(SCRIPTS)/run-cold-bootstrap-with-timer.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/run-cold-bootstrap-with-timer.sh" $(MAKE) cold-bootstrap

dev-verify: ensure-node20 ## Readiness + TLS + Kafka checks against current kubecontext (no Colima/infra/cluster teardown)
	@chmod +x "$(SCRIPTS)/dev-orchestrator.sh" && cd "$(REPO_ROOT)" && DEV_VERIFY_ONLY=1 bash "$(SCRIPTS)/dev-orchestrator.sh"

# ROLE: DEV/QA — destructive cold-boot (see scripts/test-dev-cold-start.sh); Phase B runs only with COLD_START_CONFIRM=yes
test-dev-cold-start: ensure-node20 ## Wipe Colima/docker images/node_modules (optional certs), make dev, verify, make dev again, log bench_logs/dev-cold-start-*
	@echo "Destructive. Run:  COLD_START_CONFIRM=yes make test-dev-cold-start"
	@chmod +x "$(SCRIPTS)/test-dev-cold-start.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/test-dev-cold-start.sh"

test-dev-orchestrator-docker-break: ensure-node20 ## Failure injection: TEST_BREAK_DOCKER=1 must cause make dev to exit non-zero quickly
	@cd "$(REPO_ROOT)" && chmod +x "$(SCRIPTS)/dev-orchestrator.sh" && \
	if env TEST_BREAK_DOCKER=1 $(MAKE) dev; then echo "❌ expected make dev to fail"; exit 1; else echo "✅ TEST_BREAK_DOCKER=1 → make dev failed as expected"; fi

# Split proofs (run alone with explicit confirm):
#   COLD_BOOT_PROOF_CONFIRM=yes make cold-boot-proof
#   PREFLIGHT_PROOF_CONFIRM=yes make preflight-proof
#   IDEMPOTENCY_PROOF_CONFIRM=yes make idempotency-proof
cold-boot-proof: ensure-node20 ## Destructive cold start + dev-cold-start artifact guards only (scripts/validate-cold-boot-proof.sh)
	@chmod +x "$(SCRIPTS)/validate-cold-boot-proof.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/validate-cold-boot-proof.sh"

preflight-proof: ensure-node20 ## preflight-lab + bench_logs/run-* artifact guards (PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT=1 requires bootstrap-artifact.json + bootstrap-health score ≥ PREFLIGHT_MIN_BOOTSTRAP_HEALTH default 95)
	@chmod +x "$(SCRIPTS)/validate-preflight-proof.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/validate-preflight-proof.sh"

idempotency-proof: ensure-node20 ## make dev + dev-verify ×2 + dev-state.json guard (scripts/validate-idempotency-proof.sh)
	@chmod +x "$(SCRIPTS)/validate-idempotency-proof.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/validate-idempotency-proof.sh"

# Meta: bootstrap → cluster-doctor (strict) → preflight-proof → idempotency-proof (optional second preflight).
# Run:  FULL_STACK_PROOF_CONFIRM=yes make full-stack-proof
# Optional: FULL_STACK_PROOF_REPEAT_PREFLIGHT=yes
full-stack-proof: ensure-node20 ## Meta: bootstrap + cluster-doctor (strict) + preflight + idempotency (scripts/validate-full-stack-proof.sh)
	@chmod +x "$(SCRIPTS)/validate-full-stack-proof.sh" "$(SCRIPTS)/validate-preflight-proof.sh" "$(SCRIPTS)/validate-idempotency-proof.sh" "$(SCRIPTS)/bootstrap-cluster.sh" "$(SCRIPTS)/dev-kill-all.sh" "$(SCRIPTS)/verify-kafka-tls-sans.sh" && cd "$(REPO_ROOT)" && bash "$(SCRIPTS)/validate-full-stack-proof.sh"

dev-onboard: ensure-node20 ## LOCAL: deps + zero-trust CA + up-fast + Kafka/housing TLS gates + alignment (DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY=1 → kafka-health); EKS: verify-only
	@cd "$(REPO_ROOT)" && \
	chmod +x scripts/detect-k8s-environment.sh scripts/dev-onboard-local.sh scripts/dev-onboard-zero-trust-preflight.sh scripts/ensure-dev-root-ca.sh scripts/ensure-housing-cluster-secrets.sh && \
	_och_env=$$(bash ./scripts/detect-k8s-environment.sh 2>/dev/null || echo LOCAL); \
	if [ "$$_och_env" = "EKS" ]; then \
	  $(MAKE) dev-onboard-eks; \
	else \
	  DEV_ONBOARD_STRICT="$(DEV_ONBOARD_STRICT)" RESTORE_BACKUP_DIR="$(RESTORE_BACKUP_DIR)" bash ./scripts/dev-onboard-local.sh; \
	fi

dev-onboard-eks: ## EKS / AWS provider: no MetalLB/hosts reset — verify Kafka + edge only
	@echo "=== dev-onboard-eks (verify-only; use ACM/cert-manager + real DNS in prod) ==="
	$(MAKE) verify-kafka-cluster
	$(MAKE) verify-preflight-edge-routing
	@echo "✅ dev-onboard-eks complete"

dev-onboard-lite: ## CI-safe: bash -n scripts, kustomize kafka bundle, onboard script wiring (avoids full make -n tree)
	@set -euo pipefail; \
	_kustomize_fail() { \
	  echo "❌ Kustomize failed — check missing files, configMapGenerator paths, or bad resources:" >&2; \
	  echo "Listing infra/k8s kustomization.yaml files:" >&2; \
	  find "$(REPO_ROOT)/infra/k8s" -name kustomization.yaml -print >&2 || true; \
	  exit 1; \
	}; \
	echo "▶ bash -n scripts/*.sh"; \
	for _f in "$(SCRIPTS)"/*.sh; do [ -f "$$_f" ] || continue; bash -n "$$_f"; done; \
	echo "▶ proto files for housing configMapGenerator (flat keys → nested paths on disk)"; \
	for _p in \
	  "$(REPO_ROOT)/infra/k8s/base/config/proto/common.proto" \
	  "$(REPO_ROOT)/infra/k8s/base/config/proto/events/envelope.proto" \
	  "$(REPO_ROOT)/infra/k8s/base/config/proto/events/auth.proto" \
	  "$(REPO_ROOT)/infra/k8s/base/config/proto/events/messaging/v1/messaging_events.proto"; do \
	  test -f "$$_p" || { echo "missing required proto for kustomize: $$_p" >&2; exit 1; }; \
	done; \
	echo "▶ kubectl kustomize infra/k8s/kafka-kraft-metallb"; \
	kubectl kustomize "$(REPO_ROOT)/infra/k8s/kafka-kraft-metallb" >/dev/null \
	  || { echo "kubectl kustomize failed (kafka-kraft-metallb):" >&2; kubectl kustomize "$(REPO_ROOT)/infra/k8s/kafka-kraft-metallb" >&2 || true; _kustomize_fail; }; \
	echo "▶ kubectl kustomize infra/k8s/base + overlays/dev"; \
	kubectl kustomize "$(REPO_ROOT)/infra/k8s/base" >/dev/null \
	  || { echo "kubectl kustomize failed (housing base):" >&2; kubectl kustomize "$(REPO_ROOT)/infra/k8s/base" >&2 | tail -80 >&2 || true; _kustomize_fail; }; \
	kubectl kustomize "$(REPO_ROOT)/infra/k8s/overlays/dev" >/dev/null \
	  || { echo "kubectl kustomize failed (housing dev overlay):" >&2; kubectl kustomize "$(REPO_ROOT)/infra/k8s/overlays/dev" >&2 | tail -80 >&2 || true; _kustomize_fail; }; \
	echo "▶ (skip kubectl apply --dry-run=client: still hits apiserver for GVK/rest mapping; fails on GHA without cluster)"; \
	echo "▶ static onboard wiring"; \
	test -x "$(SCRIPTS)/dev-onboard-local.sh"; \
	test -x "$(SCRIPTS)/apply-kafka-kraft-staged.sh"; \
	test -x "$(SCRIPTS)/generate-canonical-dev-tls.sh"; \
	bash -n "$(SCRIPTS)/generate-canonical-dev-tls.sh"; \
	bash -n "$(SCRIPTS)/ci/ephemeral-k3s-converge.sh"; \
	grep -q 'generate-canonical-dev-tls.sh' "$(REPO_ROOT)/Makefile"; \
	grep -q 'dev-onboard-from-up-fast' "$(SCRIPTS)/dev-onboard-local.sh"; \
	grep -q 'dev-onboard-zero-trust-preflight' "$(SCRIPTS)/dev-onboard-local.sh"; \
	grep -q 'Phase 0.25' "$(SCRIPTS)/dev-onboard-local.sh"; \
	grep -q 'apply-kafka-kraft' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'Phase 3.5' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'up-fast' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'kafka-refresh-tls-from-lb' "$(SCRIPTS)/apply-kafka-kraft-staged.sh"; \
	grep -q 'kafka-quorum-stable' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'service-tls-alias-guard' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'edge-readiness-gate' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'kafka-alignment-suite' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'kafka-health' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	grep -q 'ensure-observability-stack-ready' "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	test -x "$(SCRIPTS)/dev-onboard-from-up-fast.sh"; \
	bash -n "$(SCRIPTS)/ensure-observability-stack-ready.sh"; \
	bash -n "$(SCRIPTS)/dev-orchestrator.sh"; \
	grep -q 'dev-up.sh' "$(REPO_ROOT)/Makefile"; \
	grep -q 'dev-onboard-from-up-fast' "$(SCRIPTS)/dev-orchestrator.sh"; \
	echo "▶ bash -n scripts/ci (smoke / verify helpers)"; \
	bash -n "$(SCRIPTS)/ci/smoke-api-gateway.sh"; \
	bash -n "$(SCRIPTS)/ci/canary-pod-stability.sh"; \
	bash -n "$(SCRIPTS)/ci/k6-smoke-incluster.sh"; \
	bash -n "$(SCRIPTS)/ci/hydrate-certs-for-ci.sh"; \
	bash -n "$(SCRIPTS)/ci/post-deploy-verify.sh"; \
	echo "✅ dev-onboard-lite OK"

# ROLE: DEV — trust local CA on macOS only
trust-ca-macos: ## Trust dev-root.pem in macOS Keychain (no-op on non-macOS). TRUST_DEV_ROOT_CA_SKIP=1 skips (avoids blocking on Keychain UI).
	@if [ "$$(uname -s)" = "Darwin" ]; then \
	  "$(SCRIPTS)/lib/trust-dev-root-ca-macos.sh" "$(REPO_ROOT)/certs/dev-root.pem"; \
	else \
	  echo "Skipping macOS trust step on non-Darwin host."; \
	fi

# ROLE: DEV/SRE — verify local curl HTTP/3 capability
# Host probe first; on Colima many Macs cannot reach MetalLB UDP/TCP — then in-cluster QUIC is authoritative.
verify-curl-http3: ## Verify curl HTTP/3 support and edge probe script
	"$(SCRIPTS)/verify-curl-http3.sh"
	"$(SCRIPTS)/verify-http3-edge.sh" || { echo "⚠️  Host edge HTTP/3 probe failed; running in-cluster QUIC verify (Colima-safe)…"; "$(SCRIPTS)/verify-caddy-http3-in-cluster.sh"; }

# ROLE: DEV/SRE — JSON + Prometheus: UDP 443 nodePort invariant, optional curl --http3 (VERIFY_HTTP3_SKIP_CURL=1 skips curl)
verify-http3-and-runtime: ensure-node20 ## Writes bench_logs/http3_edge_metrics.prom; VERIFY_HTTP3_HOST / VERIFY_HTTP3_PROM
	@cd "$(REPO_ROOT)" && node "$(SCRIPTS)/verify-http3-and-runtime.mjs"

# ROLE: DEV — host docker data-plane bring-up (no Compose Kafka; KRaft in cluster)
infra-host: ## Bring up host external infra (Postgres/Redis/MinIO); RESTORE_BACKUP_DIR=latest restores newest backup
	@mkdir -p $(BENCH)
	@export PGPASSWORD=postgres; \
	SKIP_AUTO_RESTORE=$(SKIP_AUTO_RESTORE) RESTORE_BACKUP_DIR=$(RESTORE_BACKUP_DIR) "$(SCRIPTS)/bring-up-external-infra.sh"

# ROLE: DEV — cluster deploy + restore (SKIP_CLUSTER=1 after `make cluster` avoids re-running setup-new-colima-cluster.sh)
infra-cluster: ## Compose + DBs; RESTORE_BACKUP_DIR=latest skips SQL bootstrap (dump-only). FORCE_SQL_BOOTSTRAP=1 to layer infra/db SQL.
	@export PGPASSWORD=postgres; \
	SKIP_CLUSTER=$(SKIP_CLUSTER) SKIP_BOOTSTRAP=$(SKIP_BOOTSTRAP) RESTORE_BACKUP_DIR=$(RESTORE_BACKUP_DIR) "$(SCRIPTS)/bring-up-cluster-and-infra.sh"

# ROLE: SRE — ensure Caddy LB IP exists and patch MetalLB if needed
# METALLB_FIX_LENIENT=0 (dev-onboard strict): pool apply must succeed. Default 1: tolerate apply failure.
metallb-fix: ## Check caddy-h3 LB IP and apply MetalLB fix helper (caddy may not exist until after deploy-dev)
	@kubectl -n ingress-nginx get svc caddy-h3 -o wide 2>/dev/null || echo "ℹ️  caddy-h3 not in cluster yet (normal before first deploy-dev)."
	@if [ "$${METALLB_FIX_LENIENT:-1}" = "1" ]; then \
	  "$(SCRIPTS)/apply-metallb-pool-colima.sh" || true; \
	else \
	  "$(SCRIPTS)/apply-metallb-pool-colima.sh"; \
	fi
	@kubectl get svc -n ingress-nginx 2>/dev/null || echo "ℹ️  Could not list ingress-nginx services (ns missing until deploy)."

# ROLE: DEV — /etc/hosts for edge hostname ↔ MetalLB (kubectl discovery; HOSTS_AUTO=0 for hints only)
hosts-sanity: ## Edge hostname in /etc/hosts (auto: HOSTS_AUTO=1 default; EXTERNAL_IP= to pin LB IP)
	@HOSTS_AUTO="$(HOSTS_AUTO)" EXTERNAL_IP="$(EXTERNAL_IP)" EDGE_HOSTS_STRICT=0 bash "$(SCRIPTS)/ensure-edge-hosts.sh"

ensure-edge-hosts: ## Idempotent hosts line for OCH edge hostname (EDGE_HOSTS_STRICT=1 fails if LB IP missing — dev-onboard uses this after deploy)
	@HOSTS_AUTO="$(HOSTS_AUTO)" EXTERNAL_IP="$(EXTERNAL_IP)" EDGE_HOSTS_STRICT="$${EDGE_HOSTS_STRICT:-0}" bash "$(SCRIPTS)/ensure-edge-hosts.sh"

# ROLE: DEV — quick preflight gate before long runs
preflight-gate: ## Run ensure-ready-for-preflight gate
	"$(SCRIPTS)/ensure-ready-for-preflight.sh"

# ROLE: SRE — create SSL keylog file and seed QUIC handshake
sslkeylog-seed: ## Rotate SSLKEYLOGFILE and generate one HTTP/3 handshake
	@mkdir -p $(BENCH)
	@export SSLKEYLOGFILE="$(BENCH)/sslkeylog-$$(date +%Y%m%d-%H%M%S).log"; \
	  echo "SSLKEYLOGFILE=$$SSLKEYLOGFILE"; \
	  curl --cacert certs/dev-root.pem -sS -I --http3 https://off-campus-housing.test/ >/dev/null || true

# ROLE: DEV — optional note only; does not mutate cluster
ollama-note: ## Show optional Ollama steps for analytics listing-feel
	@echo "Optional Ollama steps (separate terminal):"
	@echo "  ollama serve"
	@echo "  ollama pull llama3.2"
	@echo "  make ollama-env"

# ROLE: DEV — optional env set for analytics-service
ollama-env: ## Point analytics-service to host Ollama
	kubectl set env deployment/analytics-service -n off-campus-housing-tracker OLLAMA_BASE_URL=http://host.docker.internal:11434

# ROLE: PERF — current performance suite
test-current: ## Current perf model suite: run default service ceiling sweep + auto model derivation
	$(MAKE) ceiling
	$(MAKE) model
	$(MAKE) summarize-ceiling

# ROLE: DEV/PERF — full validation + modeling
test: ## Full validation pass: preflight/suites, then current perf-model ceiling suite
	$(MAKE) strict-canonical
	$(MAKE) collapse-all
	node "$(SCRIPTS)/load/derive-service-model.js" --all --pools "$(POOL_SIZES)"
	$(MAKE) summarize-ceiling
	$(MAKE) generate-report

# ROLE: SRE — strict canonical preflight bundle
strict-canonical: ## Run strict canonical preflight flow
	mkdir -p "$(REPO_ROOT)/bench_logs"
	METALLB_ENABLED=$(TEST_METALLB_ENABLED) REQUIRE_COLIMA=$(TEST_REQUIRE_COLIMA) RUN_PGBENCH=$(TEST_RUN_PGBENCH) \
	  PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=$(TEST_K6_MESSAGING_LIMIT_FINDER) \
	  PREFLIGHT_PERF_ARTIFACTS=$(TEST_PREFLIGHT_PERF_ARTIFACTS) PREFLIGHT_PERF_PROTOCOL_MATRIX=$(TEST_PREFLIGHT_PERF_PROTOCOL_MATRIX) \
	  PREFLIGHT_PERF_STRICT_CANONICAL=$(TEST_PREFLIGHT_PERF_STRICT_CANONICAL) PREFLIGHT_PERF_FLATTEN_TO_10=$(TEST_PREFLIGHT_PERF_FLATTEN_TO_10) \
	  PREFLIGHT_PERF_ENSURE_XK6_HTTP3=$(TEST_PREFLIGHT_PERF_ENSURE_XK6_HTTP3) \
	  bash "$(SCRIPTS)/run-preflight-scale-and-all-suites.sh"

model: ## Derive service model from bench_logs/protocol-comparison.csv
	node "$(SCRIPTS)/load/derive-service-model.js" --all --pools "$(POOL_SIZES)" "$(REPO_ROOT)/bench_logs/protocol-comparison.csv"

performance-lab-interpret: ## Build classification + merit + collapse + final report from combined CSV
	@if [ -z "$(CSV)" ]; then \
		echo "❌ CSV required. Example: make performance-lab-interpret CSV=$(REPO_ROOT)/bench_logs/ceiling/<stamp>/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/perf/build-performance-lab.js" --input "$(CSV)" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

performance-lab-interpret-latest: ## Build interpretation outputs from latest combined-10 CSV automatically
	@csv="$$(ls -t "$(REPO_ROOT)/bench_logs/ceiling/"*/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv 2>/dev/null | head -1)"; \
	if [ -z "$$csv" ]; then \
		echo "❌ No combined CSV found under bench_logs/ceiling/*/combined-10"; \
		exit 1; \
	fi; \
	echo "Using $$csv"; \
	node "$(SCRIPTS)/perf/build-performance-lab.js" --input "$$csv" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

performance-lab-one: ## One command: latest ceiling run -> combined-10 -> performance-lab outputs
	@run="$$(ls -td "$(REPO_ROOT)/bench_logs/ceiling/"* 2>/dev/null | head -1)"; \
	if [ -z "$$run" ]; then \
		echo "❌ No ceiling run found under bench_logs/ceiling"; \
		exit 1; \
	fi; \
	if [ ! -f "$$run/results.csv" ]; then \
		echo "❌ Latest ceiling run missing results.csv: $$run"; \
		exit 1; \
	fi; \
	echo "Using run $$run"; \
	node "$(SCRIPTS)/perf/build-combined-10.js" --run-dir "$$run"; \
	node "$(SCRIPTS)/perf/build-performance-lab.js" --input "$$run/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

capacity-recommend: ## Generate recommended pool sizes + ingress tuning + dashboard schema
	node "$(SCRIPTS)/capacity/derive-pool-sizes.js" --perf-dir "$(BENCH)/performance-lab" --min-pool "$(MIN_RECOMMENDED_POOL)"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

bundle-performance-lab-10: ## Merge bench_logs/performance-lab into PERF_LAB_CANONICAL_10/ (10 files, full content)
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

capacity-one: ## One command: latest ceiling -> lab + capacity + happiness + τ<0 H2 hints + dashboards + 10-file bundle
	$(MAKE) performance-lab-one
	$(MAKE) capacity-recommend
	$(MAKE) protocol-happiness
	$(MAKE) transport-routing-hints
	$(MAKE) perf-lab-dashboards

# ROLE: PERF — tail-weighted protocol scores + HTTP/3 dominance thresholds (needs service-model + collapse-summary)
protocol-happiness: ## Write protocol-happiness-matrix.json, protocol-superiority-scores.json, protocol-ranking.md
	@run="$$(ls -td "$(REPO_ROOT)/bench_logs/ceiling/"* 2>/dev/null | head -1)"; \
	sm="$$run/service-model.json"; \
	cl="$(BENCH)/performance-lab/collapse-summary.json"; \
	if [ -z "$$run" ] || [ ! -f "$$sm" ]; then \
		echo "❌ Need latest bench_logs/ceiling/*/service-model.json (run make ceiling first)"; \
		exit 1; \
	fi; \
	if [ ! -f "$$cl" ]; then \
		echo "❌ Missing $$cl — run make performance-lab-one first"; \
		exit 1; \
	fi; \
	node "$(SCRIPTS)/protocol/compute-happiness.js" --service-model "$$sm" --collapse "$$cl" --out-dir "$(BENCH)/performance-lab"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

# ROLE: PERF — τ<0 → prefer HTTP/2 defaults (transport-default-hints.json; optional k8s list)
transport-routing-hints: ## From protocol-happiness-matrix → bench_logs/performance-lab/transport-default-hints.json
	node "$(SCRIPTS)/protocol/build-transport-default-hints.js" --perf-dir "$(BENCH)/performance-lab"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

transport-routing-hints-sync-k8s: ## Same + write infra/k8s/base/config/transport-routing-defaults.json (commit when routing policy changes)
	node "$(SCRIPTS)/protocol/build-transport-default-hints.js" --perf-dir "$(BENCH)/performance-lab" --also-k8s
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

# ROLE: PERF — envelope-dashboard.json + transport-dominance-heatmap.json (needs latest ceiling service-model)
perf-lab-dashboards: ## JSON for dashboards / heatmaps from performance-lab + latest ceiling service-model
	node "$(SCRIPTS)/protocol/build-envelope-dashboard.js" --perf-dir "$(BENCH)/performance-lab"
	@run="$$(ls -td "$(REPO_ROOT)/bench_logs/ceiling/"* 2>/dev/null | head -1)"; \
	sm="$$run/service-model.json"; \
	if [ -z "$$run" ] || [ ! -f "$$sm" ]; then \
		echo "❌ Need bench_logs/ceiling/*/service-model.json for heatmap"; \
		exit 1; \
	fi; \
	node "$(SCRIPTS)/protocol/build-dominance-heatmap.js" --service-model "$$sm" --out-dir "$(BENCH)/performance-lab"
	node "$(SCRIPTS)/perf/bundle-performance-lab-10.js" --perf-dir "$(BENCH)/performance-lab"

# ROLE: PERF — lab recommendations vs declared caps (used by scripts/deploy-dev.sh)
strict-envelope-check: ## Fail if recommended_pool or stream caps exceed strict-envelope.json
	node "$(SCRIPTS)/protocol/strict-envelope-check.js" --perf-dir "$(BENCH)/performance-lab"

# ROLE: PERF — suggest pools from observed λ (JSON) and μ; default util=0.75 (advisory)
adaptive-pool-suggest: ## Usage: make adaptive-pool-suggest OBSERVED_RPS_JSON=/path/to.json
	@if [ -z "$(OBSERVED_RPS_JSON)" ]; then \
		echo "❌ Set OBSERVED_RPS_JSON=path/to/observed-rps.json (e.g. scripts/protocol/fixtures/example-observed-rps.json)"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/protocol/adaptive-pool-suggest.js" --perf-dir "$(BENCH)/performance-lab" --observed-rps "$(OBSERVED_RPS_JSON)" --util 0.75 --min-pool "$(MIN_RECOMMENDED_POOL)"

# ROLE: PERF — automated production-readiness gate (strict; often fails on raw lab until tuned)
declare-readiness: ## Run declare-readiness.js on bench_logs/performance-lab (see also: scripts/protocol/fixtures)
	node "$(SCRIPTS)/protocol/declare-readiness.js" --perf-dir "$(BENCH)/performance-lab"

shellcheck-preflight: ## ShellCheck scripts/run-preflight-scale-and-all-suites.sh (install shellcheck if missing)
	@command -v shellcheck >/dev/null 2>&1 || { echo "Install shellcheck (brew install shellcheck / apt install shellcheck)"; exit 1; }
	shellcheck "$(SCRIPTS)/run-preflight-scale-and-all-suites.sh"

# ROLE: DEV — after docker compose up: assert 5441–5448 + 6380 are published (see docker-compose.yml)
verify-docker-ports: ## Require mapped host ports for OCH Postgres + Redis (docker ps)
	bash "$(SCRIPTS)/ci/verify-docker-ports.sh"

# ROLE: LIFECYCLE — register → DELETE /account → poll auth.auth_outbox drain (+ optional processed_events). Needs auth HTTP + psql.
verify-deletion-flow: ## VERIFY_AUTH_URL, POSTGRES_URL_AUTH (or 5441 defaults); optional VERIFY_POSTGRES_URL_* for consumers
	bash "$(SCRIPTS)/verify-deletion-flow.sh"

# ROLE: DEV — recreate 8 Postgres containers so compose `command:` (e.g. max_connections) applies; keeps volumes
recycle-postgres-infra: ## Safe stop/rm/up for OCH Postgres + optional psql max_connections check
	bash "$(SCRIPTS)/recycle-och-postgres-compose.sh"

# ROLE: PERF / SRE — MetalLB edge H2/H3 strict + gRPC roll-up (needs live cluster + curl --http3-only)
full-edge-transport-validation: ## Write bench_logs/transport-lab/transport-validation-report.json
	bash "$(SCRIPTS)/protocol/full-edge-transport-validation.sh" "$(BENCH)/transport-lab"

transport-lab: ## transport-lab/ + final-transport-artifact.json; optional QUIC: TRANSPORT_LAB_QUIC=1 (see scripts/transport/run-transport-lab.sh)
	bash "$(SCRIPTS)/transport/run-transport-lab.sh"

# ROLE: CI / SRE — single red/green OCH transport certification (strict-quic + H2 collapse gate)
certify: ## Full certification: extract anomalies → unit → strict e2e → transport-lab → declare-readiness
	bash "$(SCRIPTS)/ci/run-full-certification.sh"

endpoint-coverage: ## Heuristic route inventory vs tests → bench_logs/performance-lab/endpoint-coverage-report.json
	node "$(SCRIPTS)/protocol/endpoint-coverage-analyze.js" --repo-root "$(REPO_ROOT)" --out "$(BENCH)/performance-lab/endpoint-coverage-report.json"

collapse-smoke: ## k6 gateway health H2/H3 smoke (fail_rate<1%, p95<800 on H2 script)
	bash "$(SCRIPTS)/protocol/collapse-smoke-h2-h3.sh" "$(BENCH)/transport-lab"

# ROLE: SRE — destructive dev-only chaos (require CHAOS_CONFIRM=1 inside scripts)
chaos-kafka-broker: ## Delete kafka-1 pod, then verify-kafka-cluster (optional START_K6_LOAD=1 CHAOS_K6_SCRIPT=path)
	CHAOS_CONFIRM=1 bash "$(SCRIPTS)/chaos-kafka-broker.sh"

chaos-metallb-kafka-lb: ## Delete kafka-0-external Service, refresh TLS path, verify-kafka-cluster
	CHAOS_CONFIRM=1 bash "$(SCRIPTS)/chaos-metallb-kafka-lb.sh"

chaos-test: chaos-kafka-broker ## Alias: broker-delete chaos path

sync-prometheus-kafka-rules: ## Apply Kafka health Prometheus rule ConfigMap (observability ns)
	kubectl apply -f "$(REPO_ROOT)/infra/k8s/base/observability/prometheus-rules-kafka-health.yaml"

observability-ready: ## Apply observability kustomize + wait Jaeger/OTel/Prometheus/Grafana (used by make dev / dev-onboard tail)
	chmod +x "$(SCRIPTS)/ensure-observability-stack-ready.sh"
	bash "$(SCRIPTS)/ensure-observability-stack-ready.sh"

# ROLE: SRE — production readiness chain (needs live cluster + prior perf artifacts for some gates)
certify-production: ## verify-network-coherence + verify-kafka-cluster + edge + transport + strict-envelope + collapse-smoke
	@set -euo pipefail; \
	if [ "$${CERTIFY_SKIP_NETWORK_COHERENCE:-0}" != "1" ]; then \
	  echo "▶ verify-network-coherence"; $(MAKE) verify-network-coherence; \
	fi; \
	echo "▶ verify-kafka-cluster"; $(MAKE) verify-kafka-cluster; \
	echo "▶ verify-preflight-edge-routing"; $(MAKE) verify-preflight-edge-routing; \
	echo "▶ full-edge-transport-validation"; $(MAKE) full-edge-transport-validation; \
	echo "▶ strict-envelope-check"; $(MAKE) strict-envelope-check; \
	echo "▶ collapse-smoke"; $(MAKE) collapse-smoke; \
	echo ""; echo "✅ certify-production complete"

# ROLE: PERF — EXPLAIN across all housing Postgres instances (host ports 5441–5448; see script for DB list)
explain-all-dbs: ## Run EXPLAIN ANALYZE for every housing DB (needs local psql + reachable Postgres)
	@mkdir -p $(BENCH)
	bash "$(SCRIPTS)/perf/run-all-explain.sh" $(BENCH)/explain-all-$$(date +%Y%m%d-%H%M%S).md

summarize-ceiling: ## Build protocol-side-by-side.csv + protocol-anomalies.csv from CEILING_RESULTS (or latest ceiling run)
	@csv="$${CEILING_RESULTS:-$$(ls -td "$(REPO_ROOT)/bench_logs/ceiling/"* 2>/dev/null | head -1)/results.csv}"; \
	  echo "Using $$csv"; \
	  node "$(SCRIPTS)/load/summarize-ceiling-matrix.js" "$$csv"

ceiling-default: test-current ## Alias for default ceiling sweep

# ROLE: PERF — default all-service ceiling sweep
ceiling: ## Default service collapse sweep
	SERVICES="$(CEILING_SERVICES)" PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash "$(SCRIPTS)/load/run-service-ceiling.sh"

# ROLE: PERF — single service collapse sweeps
collapse-trust: ## Collapse sweep for trust service
	SERVICES=trust PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash "$(SCRIPTS)/load/run-service-ceiling.sh"
	node "$(SCRIPTS)/load/derive-service-model.js" --service trust --pools "$(POOL_SIZES)"

collapse-messaging: ## Collapse sweep for messaging service
	SERVICES=messaging PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash "$(SCRIPTS)/load/run-service-ceiling.sh"
	node "$(SCRIPTS)/load/derive-service-model.js" --service messaging --pools "$(POOL_SIZES)"

collapse-all: ## Collapse sweep for all configured services
	SERVICES="$(CEILING_SERVICES)" PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash "$(SCRIPTS)/load/run-service-ceiling.sh"
	node "$(SCRIPTS)/load/derive-service-model.js" --all --pools "$(POOL_SIZES)"
	node "$(SCRIPTS)/perf/summarize-collapse.js"

# ROLE: PERF/SRE — protocol matrix smoke across services
protocol-matrix: ## Run protocol matrix and summarize markdown+csv
	SSL_CERT_FILE="$(REPO_ROOT)/certs/dev-root.pem" K6_MATRIX_ENSURE_HTTP3=1 \
	  bash "$(SCRIPTS)/load/run-k6-protocol-matrix.sh"
	node "$(SCRIPTS)/perf/extract-protocol-matrix.js"

# ROLE: SRE — packet capture with explicit edge IP
packet-capture: ## Run packet capture standalone with TARGET_IP
	@if [ -z "$(TARGET_IP)" ]; then \
		echo "❌ TARGET_IP required. Example: make packet-capture TARGET_IP=192.168.64.245"; \
		exit 1; \
	fi
	@mkdir -p $(BENCH)
	export SSLKEYLOGFILE="$(BENCH)/sslkeylog-capture-$$(date +%Y%m%d-%H%M%S).log"; \
	export TARGET_IP="$(TARGET_IP)"; \
	bash "$(SCRIPTS)/test-packet-capture-standalone.sh"

# ROLE: PERF — report/visualization orchestration
perf-lab: ## Ceiling + model + summaries + reports
	$(MAKE) ceiling
	$(MAKE) model
	$(MAKE) summarize-ceiling
	$(MAKE) generate-report

perf-full: ## Full modeling + visualization bundle
	$(MAKE) collapse-all
	$(MAKE) generate-report
	$(MAKE) graph-capacity
	$(MAKE) heatmap-tail

generate-report: ## Emit markdown/html performance report from latest runs
	@if [ "$(GENERATE_MD_REPORT)" = "1" ]; then \
		node "$(SCRIPTS)/perf/generate-report.js" --format md; \
	fi
	@if [ "$(GENERATE_HTML_REPORT)" = "1" ]; then \
		node "$(SCRIPTS)/perf/generate-report.js" --format html; \
	fi

graph-capacity: ## Generate capacity graph SVGs from service-model outputs
	node "$(SCRIPTS)/perf/graph-capacity.js"

heatmap-tail: ## Generate tail amplification heatmap SVG
	node "$(SCRIPTS)/perf/heatmap-tail.js"

compare-run: ## Compare two runs: make compare-run RUN1=... RUN2=...
	@if [ -z "$(RUN1)" ] || [ -z "$(RUN2)" ]; then \
		echo "❌ RUN1 and RUN2 required"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/perf/compare-runs.js" --run1 "$(RUN1)" --run2 "$(RUN2)"

regression-guard: ## Fail when p95 regression exceeds threshold
	@if [ -z "$(RUN1)" ] || [ -z "$(RUN2)" ]; then \
		echo "❌ RUN1 and RUN2 required"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/perf/regression-check.js" --baseline "$(RUN1)" --candidate "$(RUN2)" --threshold "$(REGRESSION_THRESHOLD_P95)"

slack-report: ## Post latest markdown report to Slack webhook
	@if [ -z "$(SLACK_WEBHOOK)" ]; then \
		echo "❌ SLACK_WEBHOOK not set"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/perf/post-report.js" --webhook "$(SLACK_WEBHOOK)"

discord-report: ## Post latest markdown report to Discord webhook
	@if [ -z "$(DISCORD_WEBHOOK)" ]; then \
		echo "❌ DISCORD_WEBHOOK not set"; \
		exit 1; \
	fi
	node "$(SCRIPTS)/perf/post-report.js" --webhook "$(DISCORD_WEBHOOK)"

ci: ## CI-safe headless preflight + model derivation
	CI_MODE=1 HEADLESS=1 REQUIRE_COLIMA=0 METALLB_ENABLED=0 RUN_PGBENCH=0 \
	  PREFLIGHT_PERF_PROTOCOL_MATRIX=1 \
	  bash "$(SCRIPTS)/run-preflight-scale-and-all-suites.sh"
	node "$(SCRIPTS)/load/derive-service-model.js" --all --pools "10,20"

ci-full: ## CI-safe full perf + regression guard
	$(MAKE) ci
	$(MAKE) collapse-all
	$(MAKE) generate-report
	@echo "Set RUN1 and RUN2 for regression-guard to enforce comparison."

images: ## Build housing :dev images and load into Colima/k3s (./scripts/build-housing-images-k3s.sh)
	bash "$(SCRIPTS)/build-housing-images-k3s.sh"

images-all: ## Build all housing :dev images, load Colima, rollout each deploy (watchdog → api-gateway)
	bash -n "$(SCRIPTS)/rebuild-all-housing-images-k3s.sh"
	bash "$(SCRIPTS)/rebuild-all-housing-images-k3s.sh"

build-all-images: images-all ## Alias for bootstrap / CI (use ROLLOUT=0 before first kubectl apply if deploys do not exist yet)

golden-snapshot: ## Rebuild :dev + rollouts + kafka-health + alignment (GOLDEN_SNAPSHOT_CHAOS=1 → destructive alignment + chaos-suite-kafka)
	bash -n "$(SCRIPTS)/golden-snapshot-verify.sh"
	chmod +x "$(SCRIPTS)/golden-snapshot-verify.sh"
	bash "$(SCRIPTS)/golden-snapshot-verify.sh"

kustomize-apply: ## Apply dev overlay (kubectl kustomize, or kustomize if installed)
	cd "$(REPO_ROOT)" && (command -v kustomize >/dev/null && kustomize build infra/k8s/overlays/dev || kubectl kustomize infra/k8s/overlays/dev) | kubectl apply -f -

deploy-dev: ## Apply + smoke + rollout wait (SKIP_STRICT_ENVELOPE=1 if strict-envelope check should be skipped)
	bash "$(SCRIPTS)/deploy-dev.sh"

rollouts: deploy-dev ## Alias: same as deploy-dev

stack: ## Full idempotent stack setup WITHOUT preflight (Colima, infra, certs, DBs, Kafka, build, deploy, secrets, event-layer)
	bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"

demo: ## Colima+k3s stack + preflight (MetalLB + k6 LB IP); stops after housing suites+Playwright; no k3d
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1 PREFLIGHT_PHASE_D_TAIL_LAB=0 \
	  bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"

demo-full: ## Colima+k3s + full preflight continuation (transport/pgbench when enabled); no early exit
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_FULL_LOAD=1 RUN_PREFLIGHT=1 \
	  PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=0 \
	  bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"

demo-network: ## Colima path: preflight + sslkeylog + packet capture (./scripts/run-demo-network-preflight.sh)
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 bash "$(SCRIPTS)/run-demo-network-preflight.sh"

demo-k3d: ## stack + preflight for k3d (no Colima): set kubectl context to k3d first
	METALLB_ENABLED=1 METALLB_USE_K3D=1 REQUIRE_COLIMA=0 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  PREFLIGHT_PHASE_D_TAIL_LAB=0 SKIP_COLIMA=1 bash "$(SCRIPTS)/setup-full-off-campus-housing-stack.sh"

preflight-metallb: ## Run preflight only (MetalLB + k6 LB IP). Example: RUN_PGBENCH=0 RUN_FULL_LOAD=0 make preflight-metallb
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 bash "$(SCRIPTS)/run-preflight-scale-and-all-suites.sh"

# Canonical Colima + MetalLB lab preflight without host pgbench / full load (matches common manual one-liner).
preflight-colima-metallb-edge: ## Colima+MetalLB edge preflight; RUN_PGBENCH=0 RUN_FULL_LOAD=0
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 bash "$(SCRIPTS)/run-preflight-scale-and-all-suites.sh"

preflight-strict: ensure-node20 ## Strict preflight: Colima+MetalLB+Jaeger+OTel+k6+Kafka alignment suite (KAFKA_ALIGNMENT_TEST_MODE=1). Prefer preflight-lab.
	cd "$(REPO_ROOT)" && \
	  export METALLB_ENABLED=1 METALLB_USE_K3D=0 REQUIRE_COLIMA=1 K6_USE_METALLB=1 && \
	  export OTEL_PREFLIGHT_TRACE_SAMPLE=1 RUN_K6=1 && \
	  export PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=0 KAFKA_ALIGNMENT_TEST_MODE=1 && \
	  if [ -n "$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)" ]; then export JAEGER_QUERY_BASE="$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)"; fi && \
	  bash "$(SCRIPTS)/cluster-stability-guard.sh" && \
	  $(MAKE) transport-quic-v6-v7-prove && \
	  export PREFLIGHT_STRICT_EXIT=1 PREFLIGHT_PERF_ARTIFACTS=1 && \
	  export PREFLIGHT_RUN_CLUSTER_STABILITY_GUARD=1 PREFLIGHT_ENSURE_METRICS_SERVER=1 && \
	  export PREFLIGHT_STEP7_OBSERVABILITY_GATES=1 && \
	  pnpm preflight-and-suites

.PHONY: preflight-lab
preflight-lab: preflight-strict ## ONE canonical Colima lab command (same as preflight-strict; Kafka alignment chaos on; see header comments).
	@true

.PHONY: validate-observability
validate-observability: ## Jaeger Step7 span-tree + overlap gates (needs JAEGER_QUERY_BASE; see docs/observability/och-observability-integrity-spec-v1.md)
	cd "$(REPO_ROOT)" && pnpm run validate-observability

# Phase Barrier Contract — same Jaeger/Colima defaults as preflight-lab when PREFLIGHT_STRICT_JAEGER_QUERY_BASE is set. See docs/preflight-phase-barrier-contract.md
PHASE_NAME ?= generic
.PHONY: phase-barrier
phase-barrier: ## Manual barrier: make phase-barrier PHASE_NAME=post-kafka-alignment (optional: PREFLIGHT_STRICT_JAEGER_QUERY_BASE=)
	cd "$(REPO_ROOT)" && \
	  export METALLB_ENABLED=1 METALLB_USE_K3D=0 REQUIRE_COLIMA=1 K6_USE_METALLB=1 && \
	  if [ -n "$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)" ]; then export JAEGER_QUERY_BASE="$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)"; fi && \
	  bash "$(SCRIPTS)/phase-barrier.sh" "$(PHASE_NAME)"

preflight-strict-full-matrix: ## Like preflight-strict but PLAYWRIGHT_E2E_MATRIX=full (same lab + Kafka alignment exports)
	cd "$(REPO_ROOT)" && \
	  export METALLB_ENABLED=1 METALLB_USE_K3D=0 REQUIRE_COLIMA=1 K6_USE_METALLB=1 && \
	  export OTEL_PREFLIGHT_TRACE_SAMPLE=1 RUN_K6=1 && \
	  export PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=0 KAFKA_ALIGNMENT_TEST_MODE=1 && \
	  if [ -n "$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)" ]; then export JAEGER_QUERY_BASE="$(PREFLIGHT_STRICT_JAEGER_QUERY_BASE)"; fi && \
	  export PREFLIGHT_STRICT_EXIT=1 PREFLIGHT_PERF_ARTIFACTS=1 PLAYWRIGHT_E2E_MATRIX=full && \
	  export PREFLIGHT_STEP7_OBSERVABILITY_GATES=1 && \
	  pnpm preflight-and-suites

e2e-full-strict: ## All Playwright projects in strict HTTP3 mode (needs JAEGER_QUERY_BASE + TLS edge; set Jaeger if not auto-wired)
	cd "$(REPO_ROOT)" && \
	  export NODE_EXTRA_CA_CERTS="$(REPO_ROOT)/certs/dev-root.pem" && \
	  export E2E_API_BASE="https://off-campus-housing.test" && \
	  pnpm run test:webapp:e2e:full-strict

test-e2e-integrated: ## Port-forward api-gateway + Playwright (needs running cluster)
	cd "$(REPO_ROOT)" && pnpm run test:e2e:integrated

packet-capture-standalone: ## gRPC/HTTP2/HTTP3 capture smoke (needs cluster + MetalLB IP; sets PORT=443 if TARGET_IP set)
	bash "$(SCRIPTS)/test-packet-capture-standalone.sh"

# Replicable HTTP/3 proof: MetalLB IP + curl --http3-only + STRICT capture + transport-summary-v6.json + jq assert.
transport-quic-v6-prove: ## Colima/MetalLB: standalone capture + v6 artifact (needs kubectl, tshark, jq, curl w/ HTTP3)
	@command -v tshark >/dev/null 2>&1 || { echo "tshark required (e.g. brew install --cask wireshark)"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "jq required"; exit 1; }
	cd "$(REPO_ROOT)" && \
	  _lb="$$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)" && \
	  test -n "$$_lb" || { echo "No MetalLB IP on ingress-nginx/caddy-h3"; exit 1; } && \
	  _kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \
	  rm -f "$$_kl" && touch "$$_kl" && \
	  HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \
	    bash "$(SCRIPTS)/test-packet-capture-standalone.sh" && \
	  _dir="$$(ls -dt /tmp/packet-captures-v2-* | head -1)" && \
	  mkdir -p "$(REPO_ROOT)/bench_logs" && echo "$$_dir" > "$(REPO_ROOT)/bench_logs/.last-transport-quic-prove-dir" && \
	  echo "Capture dir: $$_dir" && \
	  echo "Key log: $$_kl" && \
	  echo "" && \
	  echo "Validating QUIC v6 artifact..." && \
	  jq -e '.valid == true and (.quic_frame_count > 0) and (.packet_number_spaces | length > 0) and (.tls.selected_cipher_suite != null and (.tls.selected_cipher_suite | tostring | length > 0))' "$$_dir/transport-summary-v6.json" >/dev/null && \
	  echo "✅ Core QUIC validation OK" && \
	  echo "" && \
	  echo "--- transport-summary-v6.json ---" && \
	  jq . "$$_dir/transport-summary-v6.json" && \
	  echo "" && \
	  echo "--- QUIC packet numbers (tshark, sample) ---" && \
	  ( tshark -r "$$_dir/caddy-capture.pcap" -Y quic -T fields -e quic.packet_number 2>/dev/null | head || true ) && \
	  echo "" && \
	  echo "--- ALPN h3 check ---" && \
	  ( tshark -r "$$_dir/caddy-capture.pcap" -o tls.keylog_file:"$$_kl" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | head || true ) && \
	  echo "" && \
	  echo "HTTP/3 transport v6 proven. Latest capture dir: $$_dir"

# One capture, two jq gates (reproducible single pcap dir for v6 + v7 artifacts).
transport-quic-v6-v7-prove: ## Single standalone run; strict jq on transport-summary-v6.json then v7 (writes bench_logs/.last-transport-quic-prove-dir)
	@command -v tshark >/dev/null 2>&1 || { echo "tshark required"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "jq required"; exit 1; }
	cd "$(REPO_ROOT)" && \
	  mkdir -p "$(REPO_ROOT)/bench_logs" && \
	  _lb="$$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)" && \
	  test -n "$$_lb" || { echo "No MetalLB IP on ingress-nginx/caddy-h3"; exit 1; } && \
	  _kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \
	  rm -f "$$_kl" && touch "$$_kl" && \
	  HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \
	    bash "$(SCRIPTS)/test-packet-capture-standalone.sh" && \
	  _dir="$$(ls -dt /tmp/packet-captures-v2-* | head -1)" && \
	  echo "$$_dir" > "$(REPO_ROOT)/bench_logs/.last-transport-quic-prove-dir" && \
	  echo "Capture dir: $$_dir" && echo "Key log: $$_kl" && \
	  echo "Validating v6 artifact..." && \
	  jq -e '.valid == true and (.quic_frame_count > 0) and (.packet_number_spaces | length > 0) and (.tls.selected_cipher_suite != null and (.tls.selected_cipher_suite | tostring | length > 0))' "$$_dir/transport-summary-v6.json" >/dev/null && \
	  echo "Validating v7 invariant..." && \
	  jq -e '.valid == true and (.quic.frame_count > 0) and (.quic.packet_number_spaces | length > 0) and (.tls.selected_cipher_suite != null and (.tls.selected_cipher_suite | tostring | length > 0)) and (.tls.alpn_protocol == "h3") and (.quic.version_negotiation_packets == 0) and ([.quic.packet_number_spaces[] | select(.space == "1RTT")] | length > 0)' "$$_dir/transport-summary-v7.json" >/dev/null && \
	  echo "" && \
	  echo "--- transport-summary-v6.json ---" && \
	  jq . "$$_dir/transport-summary-v6.json" && \
	  echo "" && \
	  echo "--- transport-summary-v7.json ---" && \
	  jq . "$$_dir/transport-summary-v7.json" && \
	  echo "" && \
	  ( if [[ -n "$${JAEGER_QUERY_BASE:-}" ]]; then \
	      QUIC_JAEGER_CORRELATION_REQUIRE="$${QUIC_JAEGER_CORRELATION_REQUIRE:-0}" \
	      node "$(REPO_ROOT)/scripts/verify-quic-jaeger-correlation.mjs" \
	        --v7-json "$$_dir/transport-summary-v7.json" --write-back || exit 1; \
	    else \
	      echo "JAEGER_QUERY_BASE unset: skip QUIC-Jaeger correlation"; \
	    fi ) && \
	  echo "v6 + v7 strict gates passed on $$_dir"

# v7 invariant: reshaped JSON + capture window + spin metadata + cert/ALPN; optional Jaeger correlation when JAEGER_QUERY_BASE is set.
transport-quic-v7-prove: ## Same capture as v6; transport-summary-v7.json + strict jq (ALPN h3, 1RTT space, VN=0)
	@command -v tshark >/dev/null 2>&1 || { echo "tshark required (e.g. brew install --cask wireshark)"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "jq required"; exit 1; }
	cd "$(REPO_ROOT)" && \
	  mkdir -p "$(REPO_ROOT)/bench_logs" && \
	  _lb="$$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)" && \
	  test -n "$$_lb" || { echo "No MetalLB IP on ingress-nginx/caddy-h3"; exit 1; } && \
	  _kl="$(REPO_ROOT)/bench_logs/sslkeys-och-transport-$$(date +%Y%m%d-%H%M%S).log" && \
	  rm -f "$$_kl" && touch "$$_kl" && \
	  HOST=off-campus-housing.test TARGET_IP="$$_lb" PORT=443 STRICT_QUIC_VALIDATION=1 SSLKEYLOGFILE="$$_kl" \
	    bash "$(SCRIPTS)/test-packet-capture-standalone.sh" && \
	  _dir="$$(ls -dt /tmp/packet-captures-v2-* | head -1)" && \
	  echo "$$_dir" > "$(REPO_ROOT)/bench_logs/.last-transport-quic-prove-dir" && \
	  echo "Capture dir: $$_dir" && \
	  echo "Key log: $$_kl" && \
	  echo "" && \
	  echo "Validating QUIC v7 invariant..." && \
	  jq -e '.valid == true and (.quic.frame_count > 0) and (.quic.packet_number_spaces | length > 0) and (.tls.selected_cipher_suite != null and (.tls.selected_cipher_suite | tostring | length > 0)) and (.tls.alpn_protocol == "h3") and (.quic.version_negotiation_packets == 0) and ([.quic.packet_number_spaces[] | select(.space == "1RTT")] | length > 0)' "$$_dir/transport-summary-v7.json" >/dev/null && \
	  echo "Core QUIC v7 validation OK" && \
	  ( if [[ -n "$${JAEGER_QUERY_BASE:-}" ]]; then \
	      QUIC_JAEGER_CORRELATION_REQUIRE="$${QUIC_JAEGER_CORRELATION_REQUIRE:-0}" \
	      node "$(REPO_ROOT)/scripts/verify-quic-jaeger-correlation.mjs" \
	        --v7-json "$$_dir/transport-summary-v7.json" --write-back || exit 1; \
	    else \
	      echo "JAEGER_QUERY_BASE unset: skip QUIC-Jaeger correlation (optional)"; \
	    fi ) && \
	  echo "" && \
	  echo "--- transport-summary-v7.json ---" && \
	  jq . "$$_dir/transport-summary-v7.json" && \
	  echo "" && \
	  echo "--- QUIC packet numbers (tshark, sample) ---" && \
	  ( tshark -r "$$_dir/caddy-capture.pcap" -Y quic -T fields -e quic.packet_number 2>/dev/null | head || true ) && \
	  echo "" && \
	  echo "--- ALPN h3 check ---" && \
	  ( tshark -r "$$_dir/caddy-capture.pcap" -o tls.keylog_file:"$$_kl" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | head || true ) && \
	  echo "" && \
	  echo "HTTP/3 transport v7 proven. Latest capture dir: $$_dir"

cluster-forensic-sweep: ## Restart + log keyword sweep → bench_logs/forensics/cluster-sweep-*.log
	@mkdir -p $(BENCH)/forensics
	bash "$(SCRIPTS)/cluster-log-sweep.sh"

network-command-center: ## Capture + QUIC/TLS/HTTP3 analysis → bench_logs/forensics/network-cc-*
	@mkdir -p $(BENCH)/forensics
	bash "$(SCRIPTS)/network-command-center.sh"

deploy-monitoring-help: ## Print paths for Prometheus rules + Grafana stubs (apply via your stack)
	@echo "Prometheus rules: "$(REPO_ROOT)/infra/monitoring/prometheus/rules/""
	@echo "Grafana stubs:      "$(REPO_ROOT)/infra/monitoring/grafana/dashboards/""
	@echo "Docs:               "$(REPO_ROOT)/docs/CLUSTER_FORENSICS_AND_OBSERVABILITY.md""

tls-secrets-expiry-textfile: ## Emit Prometheus textfile lines (stdout); pipe to node_exporter textfile dir
	bash "$(SCRIPTS)/tls-k8s-secrets-expiry.sh"

forensic-log-sweep: ## Raw kubectl logs per container → bench_logs/forensics/run-*/forensic/ (or FORENSIC_LOG_ROOT)
	@mkdir -p $(BENCH)/forensics
	bash "$(SCRIPTS)/forensic-log-sweep.sh"

chaos-suite: ## Safe baseline chaos artifacts + report (override CHAOS_SUITE_ARTIFACT_DIR, CHAOS_SUITE=full for more)
	CHAOS_SUITE=baseline bash "$(SCRIPTS)/run-chaos-suite.sh"

chaos-suite-kafka: ## baseline + stochastic Kafka/LB/TLS chaos (needs CHAOS_CONFIRM=1 KAFKA_ALIGNMENT_TEST_MODE=1)
	CHAOS_SUITE=baseline-kafka CHAOS_KAFKA_ALIGNMENT=1 CHAOS_CONFIRM=1 KAFKA_ALIGNMENT_TEST_MODE=1 bash "$(SCRIPTS)/run-chaos-suite.sh"

governed-chaos: ## chaos-suite + failure-budget sample + resilience stub + second report
	bash "$(SCRIPTS)/run-governed-chaos.sh"

failure-budget: ## Print JSON: availability vs observability/slo.yaml (override AVAILABILITY_PCT=)
	python3 "$(SCRIPTS)/calc-failure-budget.py"

generate-chaos-report-md: ## Regenerate chaos-report.md from CHAOS_REPORT_DIR (default latest bench_logs/chaos-suite-*)
	@d="$${CHAOS_REPORT_DIR:-}"; \
	if [[ -z "$$d" ]]; then d=$$(ls -dt $(BENCH)/chaos-suite-* $(BENCH)/chaos-* 2>/dev/null | head -1); fi; \
	if [[ -z "$$d" || ! -d "$$d" ]]; then echo "No bench_logs/chaos-suite-* dir; run make chaos-suite first"; exit 1; fi; \
	python3 "$(SCRIPTS)/generate-chaos-report.py" --dir "$$d" --scenario "manual regen"

resilience-menu: ## Interactive bash menu (forensics + chaos); non-interactive: RESILIENCE_MENU_CHOICE=5 make resilience-menu
	bash "$(SCRIPTS)/resilience-interactive-menu.sh"

metrics-server-ready: ## Restart kube-system/metrics-server and wait until kubectl top nodes works (k3s/Colima)
	bash "$(SCRIPTS)/ensure-metrics-server-ready.sh"

trust-integration-tests: ## Trust HTTP+DB integration (needs Postgres 5446); SKIP_TRUST_INTEGRATION=1 to skip
	cd "$(REPO_ROOT)/services/trust-service" && pnpm run test:integration

test-vitest-stack: ## integration:all (Kafka assert) → system contracts → unit batch; same as pnpm run test:vitest-stack
	cd "$(REPO_ROOT)" && pnpm -C services/common run build && ROLLUP_DISABLE_NATIVE=true pnpm run test:vitest-stack
