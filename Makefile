# ==============================================================================
# Off-Campus-Housing-Tracker — Unified Orchestration Makefile
# ==============================================================================
# ROLE: DEV   - local bootstrap and test flows
# ROLE: PERF  - ceiling/model/report/graph workflows
# ROLE: CI    - headless-safe and regression guard flows
# ROLE: SRE   - packet capture and strict canonical validation

REPO_ROOT := $(abspath .)
SCRIPTS := $(REPO_ROOT)/scripts
BENCH := $(REPO_ROOT)/bench_logs
export PATH := $(SCRIPTS)/shims:/opt/homebrew/bin:/usr/local/bin:$(PATH)

.DEFAULT_GOAL := menu

.PHONY: menu help up up-fast deps kubeconfig-colima cluster colima-net tls-first-time trust-ca-macos verify-curl-http3 infra-host infra-cluster \
	metallb-fix hosts-sanity preflight-gate sslkeylog-seed ollama-note ollama-env test test-current model summarize-ceiling strict-canonical ceiling collapse-trust collapse-messaging collapse-all \
	protocol-matrix packet-capture perf-lab perf-full generate-report graph-capacity heatmap-tail compare-run regression-guard \
	slack-report discord-report ci ci-full ceiling-default performance-lab-interpret performance-lab-interpret-latest performance-lab-one capacity-recommend capacity-one protocol-happiness perf-lab-dashboards declare-readiness explain-all-dbs demo demo-network demo-full demo-k3d stack images kustomize-apply \
	deploy-dev rollouts preflight-metallb test-e2e-integrated packet-capture-standalone

# Default orchestration knobs for team "one-command" workflow.
UP_REQUIRE_COLIMA ?= 1
UP_METALLB_ENABLED ?= 1
METALLB_POOL ?= 192.168.64.240-192.168.64.250
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
HOSTS_AUTO ?= 0
EXTERNAL_IP ?=

help: ## List targets and short descriptions
	@echo "Off-Campus-Housing-Tracker — common make targets"
	@echo ""
	@grep -hE '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Core:"
	@echo "  make up               Full bootstrap (cluster + infra + TLS + deploy)"
	@echo "  make test             Strict canonical preflight + performance lab"
	@echo "  make test-current     Service ceiling sweep + model derivation"
	@echo "  make model            Derive model from latest protocol-comparison.csv"
	@echo "  make performance-lab-interpret CSV=<combined.csv>  Build classification/merit/report outputs"
	@echo "  make performance-lab-interpret-latest  Auto-detect latest combined CSV and build outputs"
	@echo "  make performance-lab-one  Latest ceiling run -> combined-10 + interpretation outputs"
	@echo "  make capacity-recommend  Generate pool/ingress/dashboard outputs from performance-lab"
	@echo "  make capacity-one        One command: performance-lab-one + capacity-recommend + protocol-happiness"
	@echo "  make explain-all-dbs     EXPLAIN ANALYZE across housing Postgres (5441–5448)"
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
	@echo "  make declare-readiness"
	@echo "  make protocol-matrix"
	@echo ""
	@echo "SRE / deep infra:"
	@echo "  make packet-capture TARGET_IP=<ip>"
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
	$(MAKE) verify-curl-http3
	$(MAKE) infra-host
	$(MAKE) infra-cluster
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
	$(MAKE) verify-curl-http3
	$(MAKE) infra-host
	$(MAKE) infra-cluster
	$(MAKE) metallb-fix
	$(MAKE) hosts-sanity
	$(MAKE) preflight-gate
	$(MAKE) sslkeylog-seed
	$(MAKE) ollama-note
	@echo ""
	@echo "✅ make up-fast complete."

# ROLE: DEV — fast path dependencies
deps: ## Install workspace deps + Playwright browser; ensure cluster script executable
	pnpm install
	pnpm --filter webapp exec playwright install chromium
	chmod +x $(SCRIPTS)/setup-new-colima-cluster.sh

# ROLE: DEV — optional kubeconfig export helper
kubeconfig-colima: ## Print/export Colima kubeconfig path for current shell
	@echo "If kubectl cannot see Colima, run:"
	@echo "  export KUBECONFIG=\"$(KUBECONFIG_COLIMA)\""

# ROLE: DEV — cluster bootstrap (Colima/k3s + MetalLB pool)
cluster: ## Start Colima+k3s and apply MetalLB pool
	METALLB_POOL=$(METALLB_POOL) $(SCRIPTS)/setup-new-colima-cluster.sh

# ROLE: DEV — verify Colima subnet vs MetalLB pool
colima-net: ## Show Colima eth0 subnet for MetalLB sanity
	colima ssh -- ip -4 addr show eth0

# ROLE: DEV/SRE — strict TLS + Kafka JKS chain
tls-first-time: ## Generate/reissue CA+leaf, envoy cert, strict bootstrap, kafka JKS
	KAFKA_SSL=1 $(SCRIPTS)/reissue-ca-and-leaf-load-all-services.sh
	$(SCRIPTS)/generate-envoy-client-cert.sh
	$(SCRIPTS)/strict-tls-bootstrap.sh
	$(SCRIPTS)/kafka-ssl-from-dev-root.sh

# ROLE: DEV — trust local CA on macOS only
trust-ca-macos: ## Trust dev-root.pem in macOS Keychain (no-op on non-macOS)
	@if [ "$$(uname -s)" = "Darwin" ]; then \
	  $(SCRIPTS)/lib/trust-dev-root-ca-macos.sh $(REPO_ROOT)/certs/dev-root.pem; \
	else \
	  echo "Skipping macOS trust step on non-Darwin host."; \
	fi

# ROLE: DEV/SRE — verify local curl HTTP/3 capability
verify-curl-http3: ## Verify curl HTTP/3 support and edge probe script
	$(SCRIPTS)/verify-curl-http3.sh
	$(SCRIPTS)/verify-http3-edge.sh

# ROLE: DEV — host docker data-plane bring-up
infra-host: ## Bring up host external infra (Postgres/Redis/Kafka/MinIO)
	@mkdir -p $(BENCH)
	@export PGPASSWORD=postgres; \
	RESTORE_BACKUP_DIR=$(RESTORE_BACKUP_DIR) $(SCRIPTS)/bring-up-external-infra.sh

# ROLE: DEV — cluster deploy + restore
infra-cluster: ## Bring up cluster apps + housing restore
	@export PGPASSWORD=postgres; \
	RESTORE_BACKUP_DIR=$(RESTORE_BACKUP_DIR) $(SCRIPTS)/bring-up-cluster-and-infra.sh

# ROLE: SRE — ensure Caddy LB IP exists and patch MetalLB if needed
metallb-fix: ## Check caddy-h3 LB IP and apply MetalLB fix helper
	kubectl -n ingress-nginx get svc caddy-h3 -o wide
	$(SCRIPTS)/apply-metallb-pool-colima.sh || true
	kubectl get svc -n ingress-nginx

# ROLE: DEV — hosts entry sanity or optional auto-add
hosts-sanity: ## Validate off-campus-housing.test hosts mapping (HOSTS_AUTO=1 with EXTERNAL_IP to auto-append)
	@if grep -Eq '(^|[[:space:]])off-campus-housing\.test($|[[:space:]])' /etc/hosts 2>/dev/null; then \
	  echo "hosts mapping present for off-campus-housing.test"; \
	elif [ "$(HOSTS_AUTO)" = "1" ] && [ -n "$(EXTERNAL_IP)" ]; then \
	  echo "Adding hosts entry with sudo: $(EXTERNAL_IP) off-campus-housing.test"; \
	  sudo sh -c 'echo "$(EXTERNAL_IP) off-campus-housing.test" >> /etc/hosts'; \
	else \
	  echo "⚠ hosts mapping missing. Add manually:"; \
	  echo "  sudo sh -c '\''echo \"<EXTERNAL_IP> off-campus-housing.test\" >> /etc/hosts'\''"; \
	fi

# ROLE: DEV — quick preflight gate before long runs
preflight-gate: ## Run ensure-ready-for-preflight gate
	$(SCRIPTS)/ensure-ready-for-preflight.sh

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
	node $(SCRIPTS)/load/derive-service-model.js --all --pools "$(POOL_SIZES)"
	$(MAKE) summarize-ceiling
	$(MAKE) generate-report

# ROLE: SRE — strict canonical preflight bundle
strict-canonical: ## Run strict canonical preflight flow
	mkdir -p $(REPO_ROOT)/bench_logs
	METALLB_ENABLED=$(TEST_METALLB_ENABLED) REQUIRE_COLIMA=$(TEST_REQUIRE_COLIMA) RUN_PGBENCH=$(TEST_RUN_PGBENCH) \
	  PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=$(TEST_K6_MESSAGING_LIMIT_FINDER) \
	  PREFLIGHT_PERF_ARTIFACTS=$(TEST_PREFLIGHT_PERF_ARTIFACTS) PREFLIGHT_PERF_PROTOCOL_MATRIX=$(TEST_PREFLIGHT_PERF_PROTOCOL_MATRIX) \
	  PREFLIGHT_PERF_STRICT_CANONICAL=$(TEST_PREFLIGHT_PERF_STRICT_CANONICAL) PREFLIGHT_PERF_FLATTEN_TO_10=$(TEST_PREFLIGHT_PERF_FLATTEN_TO_10) \
	  PREFLIGHT_PERF_ENSURE_XK6_HTTP3=$(TEST_PREFLIGHT_PERF_ENSURE_XK6_HTTP3) \
	  bash $(SCRIPTS)/run-preflight-scale-and-all-suites.sh

model: ## Derive service model from bench_logs/protocol-comparison.csv
	node $(SCRIPTS)/load/derive-service-model.js --all --pools "$(POOL_SIZES)" $(REPO_ROOT)/bench_logs/protocol-comparison.csv

performance-lab-interpret: ## Build classification + merit + collapse + final report from combined CSV
	@if [ -z "$(CSV)" ]; then \
		echo "❌ CSV required. Example: make performance-lab-interpret CSV=$(REPO_ROOT)/bench_logs/ceiling/<stamp>/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv"; \
		exit 1; \
	fi
	node $(SCRIPTS)/perf/build-performance-lab.js --input "$(CSV)" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"

performance-lab-interpret-latest: ## Build interpretation outputs from latest combined-10 CSV automatically
	@csv="$$(ls -t $(REPO_ROOT)/bench_logs/ceiling/*/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv 2>/dev/null | head -1)"; \
	if [ -z "$$csv" ]; then \
		echo "❌ No combined CSV found under bench_logs/ceiling/*/combined-10"; \
		exit 1; \
	fi; \
	echo "Using $$csv"; \
	node $(SCRIPTS)/perf/build-performance-lab.js --input "$$csv" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"

performance-lab-one: ## One command: latest ceiling run -> combined-10 -> performance-lab outputs
	@run="$$(ls -td $(REPO_ROOT)/bench_logs/ceiling/* 2>/dev/null | head -1)"; \
	if [ -z "$$run" ]; then \
		echo "❌ No ceiling run found under bench_logs/ceiling"; \
		exit 1; \
	fi; \
	if [ ! -f "$$run/results.csv" ]; then \
		echo "❌ Latest ceiling run missing results.csv: $$run"; \
		exit 1; \
	fi; \
	echo "Using run $$run"; \
	node $(SCRIPTS)/perf/build-combined-10.js --run-dir "$$run"; \
	node $(SCRIPTS)/perf/build-performance-lab.js --input "$$run/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv" --out-dir "$(BENCH)/performance-lab" --pools "$(POOL_SIZES)"

capacity-recommend: ## Generate recommended pool sizes + ingress tuning + dashboard schema
	node $(SCRIPTS)/capacity/derive-pool-sizes.js --perf-dir "$(BENCH)/performance-lab" --min-pool "$(MIN_RECOMMENDED_POOL)"

capacity-one: ## One command: latest ceiling -> lab + capacity + protocol happiness + dashboard JSON
	$(MAKE) performance-lab-one
	$(MAKE) capacity-recommend
	$(MAKE) protocol-happiness
	$(MAKE) perf-lab-dashboards

# ROLE: PERF — tail-weighted protocol scores + HTTP/3 dominance thresholds (needs service-model + collapse-summary)
protocol-happiness: ## Write protocol-happiness-matrix.json, protocol-superiority-scores.json, protocol-ranking.md
	@run="$$(ls -td $(REPO_ROOT)/bench_logs/ceiling/* 2>/dev/null | head -1)"; \
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
	node $(SCRIPTS)/protocol/compute-happiness.js --service-model "$$sm" --collapse "$$cl" --out-dir "$(BENCH)/performance-lab"

# ROLE: PERF — envelope-dashboard.json + transport-dominance-heatmap.json (needs latest ceiling service-model)
perf-lab-dashboards: ## JSON for dashboards / heatmaps from performance-lab + latest ceiling service-model
	node $(SCRIPTS)/protocol/build-envelope-dashboard.js --perf-dir "$(BENCH)/performance-lab"
	@run="$$(ls -td $(REPO_ROOT)/bench_logs/ceiling/* 2>/dev/null | head -1)"; \
	sm="$$run/service-model.json"; \
	if [ -z "$$run" ] || [ ! -f "$$sm" ]; then \
		echo "❌ Need bench_logs/ceiling/*/service-model.json for heatmap"; \
		exit 1; \
	fi; \
	node $(SCRIPTS)/protocol/build-dominance-heatmap.js --service-model "$$sm" --out-dir "$(BENCH)/performance-lab"

# ROLE: PERF — automated production-readiness gate (strict; often fails on raw lab until tuned)
declare-readiness: ## Run declare-readiness.js on bench_logs/performance-lab (see also: scripts/protocol/fixtures)
	node $(SCRIPTS)/protocol/declare-readiness.js --perf-dir "$(BENCH)/performance-lab"

# ROLE: PERF — EXPLAIN across all housing Postgres instances (host ports 5441–5448; see script for DB list)
explain-all-dbs: ## Run EXPLAIN ANALYZE for every housing DB (needs local psql + reachable Postgres)
	@mkdir -p $(BENCH)
	bash $(SCRIPTS)/perf/run-all-explain.sh $(BENCH)/explain-all-$$(date +%Y%m%d-%H%M%S).md

summarize-ceiling: ## Build protocol-side-by-side.csv + protocol-anomalies.csv from CEILING_RESULTS (or latest ceiling run)
	@csv="$${CEILING_RESULTS:-$$(ls -td $(REPO_ROOT)/bench_logs/ceiling/* 2>/dev/null | head -1)/results.csv}"; \
	  echo "Using $$csv"; \
	  node $(SCRIPTS)/load/summarize-ceiling-matrix.js "$$csv"

ceiling-default: test-current ## Alias for default ceiling sweep

# ROLE: PERF — default all-service ceiling sweep
ceiling: ## Default service collapse sweep
	SERVICES="$(CEILING_SERVICES)" PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash $(SCRIPTS)/load/run-service-ceiling.sh

# ROLE: PERF — single service collapse sweeps
collapse-trust: ## Collapse sweep for trust service
	SERVICES=trust PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash $(SCRIPTS)/load/run-service-ceiling.sh
	node $(SCRIPTS)/load/derive-service-model.js --service trust --pools "$(POOL_SIZES)"

collapse-messaging: ## Collapse sweep for messaging service
	SERVICES=messaging PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash $(SCRIPTS)/load/run-service-ceiling.sh
	node $(SCRIPTS)/load/derive-service-model.js --service messaging --pools "$(POOL_SIZES)"

collapse-all: ## Collapse sweep for all configured services
	SERVICES="$(CEILING_SERVICES)" PROTOCOLS="$(CEILING_PROTOCOLS)" VUS_STEPS="$(CEILING_VUS_STEPS)" DURATION="$(CEILING_DURATION)" \
	  bash $(SCRIPTS)/load/run-service-ceiling.sh
	node $(SCRIPTS)/load/derive-service-model.js --all --pools "$(POOL_SIZES)"
	node $(SCRIPTS)/perf/summarize-collapse.js

# ROLE: PERF/SRE — protocol matrix smoke across services
protocol-matrix: ## Run protocol matrix and summarize markdown+csv
	SSL_CERT_FILE="$(REPO_ROOT)/certs/dev-root.pem" K6_MATRIX_ENSURE_HTTP3=1 \
	  bash $(SCRIPTS)/load/run-k6-protocol-matrix.sh
	node $(SCRIPTS)/perf/extract-protocol-matrix.js

# ROLE: SRE — packet capture with explicit edge IP
packet-capture: ## Run packet capture standalone with TARGET_IP
	@if [ -z "$(TARGET_IP)" ]; then \
		echo "❌ TARGET_IP required. Example: make packet-capture TARGET_IP=192.168.64.245"; \
		exit 1; \
	fi
	@mkdir -p $(BENCH)
	export SSLKEYLOGFILE="$(BENCH)/sslkeylog-capture-$$(date +%Y%m%d-%H%M%S).log"; \
	export TARGET_IP="$(TARGET_IP)"; \
	bash $(SCRIPTS)/test-packet-capture-standalone.sh

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
		node $(SCRIPTS)/perf/generate-report.js --format md; \
	fi
	@if [ "$(GENERATE_HTML_REPORT)" = "1" ]; then \
		node $(SCRIPTS)/perf/generate-report.js --format html; \
	fi

graph-capacity: ## Generate capacity graph SVGs from service-model outputs
	node $(SCRIPTS)/perf/graph-capacity.js

heatmap-tail: ## Generate tail amplification heatmap SVG
	node $(SCRIPTS)/perf/heatmap-tail.js

compare-run: ## Compare two runs: make compare-run RUN1=... RUN2=...
	@if [ -z "$(RUN1)" ] || [ -z "$(RUN2)" ]; then \
		echo "❌ RUN1 and RUN2 required"; \
		exit 1; \
	fi
	node $(SCRIPTS)/perf/compare-runs.js --run1 "$(RUN1)" --run2 "$(RUN2)"

regression-guard: ## Fail when p95 regression exceeds threshold
	@if [ -z "$(RUN1)" ] || [ -z "$(RUN2)" ]; then \
		echo "❌ RUN1 and RUN2 required"; \
		exit 1; \
	fi
	node $(SCRIPTS)/perf/regression-check.js --baseline "$(RUN1)" --candidate "$(RUN2)" --threshold "$(REGRESSION_THRESHOLD_P95)"

slack-report: ## Post latest markdown report to Slack webhook
	@if [ -z "$(SLACK_WEBHOOK)" ]; then \
		echo "❌ SLACK_WEBHOOK not set"; \
		exit 1; \
	fi
	node $(SCRIPTS)/perf/post-report.js --webhook "$(SLACK_WEBHOOK)"

discord-report: ## Post latest markdown report to Discord webhook
	@if [ -z "$(DISCORD_WEBHOOK)" ]; then \
		echo "❌ DISCORD_WEBHOOK not set"; \
		exit 1; \
	fi
	node $(SCRIPTS)/perf/post-report.js --webhook "$(DISCORD_WEBHOOK)"

ci: ## CI-safe headless preflight + model derivation
	CI_MODE=1 HEADLESS=1 REQUIRE_COLIMA=0 METALLB_ENABLED=0 RUN_PGBENCH=0 \
	  PREFLIGHT_PERF_PROTOCOL_MATRIX=1 \
	  bash $(SCRIPTS)/run-preflight-scale-and-all-suites.sh
	node $(SCRIPTS)/load/derive-service-model.js --all --pools "10,20"

ci-full: ## CI-safe full perf + regression guard
	$(MAKE) ci
	$(MAKE) collapse-all
	$(MAKE) generate-report
	@echo "Set RUN1 and RUN2 for regression-guard to enforce comparison."

images: ## Build housing :dev images and load into Colima/k3s (./scripts/build-housing-images-k3s.sh)
	bash $(SCRIPTS)/build-housing-images-k3s.sh

kustomize-apply: ## kustomize build infra/k8s/overlays/dev | kubectl apply -f -
	cd $(REPO_ROOT) && kustomize build infra/k8s/overlays/dev | kubectl apply -f -

deploy-dev: ## Apply + smoke + rollout wait (./scripts/deploy-dev.sh)
	bash $(SCRIPTS)/deploy-dev.sh

rollouts: deploy-dev ## Alias: same as deploy-dev

stack: ## Full idempotent stack setup WITHOUT preflight (Colima, infra, certs, DBs, Kafka, build, deploy, secrets, event-layer)
	bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

demo: ## Colima+k3s stack + preflight (MetalLB + k6 LB IP); stops after housing suites+Playwright; no k3d
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1 PREFLIGHT_PHASE_D_TAIL_LAB=0 \
	  bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

demo-full: ## Colima+k3s + full preflight continuation (transport/pgbench when enabled); no early exit
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_FULL_LOAD=1 RUN_PREFLIGHT=1 \
	  PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=0 \
	  bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

demo-network: ## Colima path: preflight + sslkeylog + packet capture (./scripts/run-demo-network-preflight.sh)
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 bash $(SCRIPTS)/run-demo-network-preflight.sh

demo-k3d: ## stack + preflight for k3d (no Colima): set kubectl context to k3d first
	METALLB_ENABLED=1 METALLB_USE_K3D=1 REQUIRE_COLIMA=0 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  PREFLIGHT_PHASE_D_TAIL_LAB=0 SKIP_COLIMA=1 bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

preflight-metallb: ## Run preflight only (MetalLB + k6 LB IP). Example: RUN_PGBENCH=0 RUN_FULL_LOAD=0 make preflight-metallb
	REQUIRE_COLIMA=1 METALLB_USE_K3D=0 METALLB_ENABLED=1 K6_USE_METALLB=1 bash $(SCRIPTS)/run-preflight-scale-and-all-suites.sh

test-e2e-integrated: ## Port-forward api-gateway + Playwright (needs running cluster)
	cd $(REPO_ROOT) && pnpm run test:e2e:integrated

packet-capture-standalone: ## gRPC/HTTP2/HTTP3 capture smoke (needs cluster + MetalLB IP; sets PORT=443 if TARGET_IP set)
	bash $(SCRIPTS)/test-packet-capture-standalone.sh
