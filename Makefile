# Off-Campus-Housing-Tracker — bring-up, deploy, preflight, demo.
# Requires: bash, kubectl, kustomize, docker, pnpm (paths vary by OS).
# Primary path: Colima + k3s (NOT k3d). make demo / demo-network enforce REQUIRE_COLIMA=1.
# Optional: make demo-k3d for k3d + METALLB_USE_K3D=1.

REPO_ROOT := $(abspath .)
SCRIPTS := $(REPO_ROOT)/scripts
export PATH := $(SCRIPTS)/shims:/opt/homebrew/bin:/usr/local/bin:$(PATH)

.DEFAULT_GOAL := help

.PHONY: help demo demo-network demo-full demo-k3d stack images kustomize-apply deploy-dev rollouts \
	preflight-metallb test-e2e-integrated packet-capture-standalone

help: ## List targets and short descriptions
	@echo "Off-Campus-Housing-Tracker — common make targets"
	@echo ""
	@grep -hE '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "See docs/MAKE_DEMO.md for Colima vs k3d, MetalLB, and env tuning."

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
