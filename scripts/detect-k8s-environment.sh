#!/usr/bin/env bash
# Print LOCAL (Colima/k3d/kind/minikube) or EKS (AWS providerID) for Makefile / onboarding branching.
set -euo pipefail
pid="$(kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' 2>/dev/null || true)"
if [[ "$pid" == *"aws"* ]]; then
  printf 'EKS\n'
else
  printf 'LOCAL\n'
fi
