#!/usr/bin/env bash
# Reset caddy-h3 deployment to the default image (caddy:2.8) from infra/k8s/caddy-h3-deploy.yaml.
# Use when the deployment was patched to registry:5000/caddy-with-tcpdump:dev but that image
# isn't in the registry (ErrImagePull / ImagePullBackOff). This gets you to 2/2 pods.
# Usage: ./scripts/reset-caddy-h3-to-default-image.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"
DEPLOY="caddy-h3"
# Default image from caddy-h3-deploy.yaml (pullable from Docker Hub)
DEFAULT_IMAGE="${CADDY_DEFAULT_IMAGE:-caddy:2.8}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

if ! kubectl get deployment "$DEPLOY" -n "$NS" --request-timeout=5s >/dev/null 2>&1; then
  warn "Deployment $DEPLOY not found in $NS. Nothing to reset."
  exit 0
fi

_current=$(kubectl get deployment "$DEPLOY" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
if [[ "$_current" == "$DEFAULT_IMAGE" ]]; then
  ok "caddy-h3 already on default image $DEFAULT_IMAGE"
  exit 0
fi

say "Resetting caddy-h3 to default image (fixes ErrImagePull when registry image missing)"
info "Current image: $_current → $DEFAULT_IMAGE"
kubectl set image "deployment/$DEPLOY" -n "$NS" "caddy=$DEFAULT_IMAGE" --request-timeout=10s
kubectl patch deployment "$DEPLOY" -n "$NS" --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null || true
info "Waiting for rollout to 2/2..."
if kubectl rollout status "deployment/$DEPLOY" -n "$NS" --timeout=120s 2>/dev/null; then
  ok "caddy-h3 at 2/2 pods on $DEFAULT_IMAGE"
else
  warn "Rollout did not complete in 120s; check: kubectl get pods -n $NS -l app=$DEPLOY"
  exit 1
fi

# Remove any stale ReplicaSet that still has replicas with a different image (e.g. caddy-with-tcpdump:dev
# left in ImagePullBackOff). Scaling them to 0 ensures only the default-image RS has pods.
for _rs in $(kubectl get rs -n "$NS" -l app="$DEPLOY" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null); do
  _img=$(kubectl get rs "$_rs" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
  _replicas=$(kubectl get rs "$_rs" -n "$NS" -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
  if [[ -n "$_img" ]] && [[ "$_img" != "$DEFAULT_IMAGE" ]] && [[ "${_replicas:-0}" -gt 0 ]]; then
    info "Scaling down stale ReplicaSet $_rs (image $_img) to 0 so only $DEFAULT_IMAGE pods remain"
    kubectl scale rs "$_rs" -n "$NS" --replicas=0 --request-timeout=10s 2>/dev/null || true
  fi
done
