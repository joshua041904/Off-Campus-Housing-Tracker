# Off-Campus-Housing-Tracker — bring-up, deploy, preflight, demo.
# Requires: bash, kubectl, kustomize, docker, pnpm (paths vary by OS).
# Colima + k3s is the primary local stack; k3d supported with METALLB_USE_K3D=1.

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

demo: ## stack + RUN_PREFLIGHT=1 with MetalLB + k6 LB IP; skips pgbench + full-load grid (faster “whole demo”)
	METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

demo-full: ## Like demo but RUN_FULL_LOAD=1 RUN_PGBENCH=1 (long control-plane run)
	METALLB_ENABLED=1 K6_USE_METALLB=1 RUN_FULL_LOAD=1 RUN_PREFLIGHT=1 \
	  bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

demo-network: ## Preflight + suites + SSL key log + optional standalone packet capture (./scripts/run-demo-network-preflight.sh)
	bash $(SCRIPTS)/run-demo-network-preflight.sh

demo-k3d: ## stack + preflight for k3d (no Colima): set kubectl context to k3d first
	METALLB_ENABLED=1 METALLB_USE_K3D=1 REQUIRE_COLIMA=0 K6_USE_METALLB=1 RUN_PGBENCH=0 RUN_FULL_LOAD=0 RUN_PREFLIGHT=1 \
	  SKIP_COLIMA=1 bash $(SCRIPTS)/setup-full-off-campus-housing-stack.sh

preflight-metallb: ## Run preflight only (MetalLB + k6 LB IP). Example: RUN_PGBENCH=0 RUN_FULL_LOAD=0 make preflight-metallb
	METALLB_ENABLED=1 K6_USE_METALLB=1 bash $(SCRIPTS)/run-preflight-scale-and-all-suites.sh

test-e2e-integrated: ## Port-forward api-gateway + Playwright (needs running cluster)
	cd $(REPO_ROOT) && pnpm run test:e2e:integrated

packet-capture-standalone: ## gRPC/HTTP2/HTTP3 capture smoke (needs cluster + MetalLB IP; sets PORT=443 if TARGET_IP set)
	bash $(SCRIPTS)/test-packet-capture-standalone.sh
