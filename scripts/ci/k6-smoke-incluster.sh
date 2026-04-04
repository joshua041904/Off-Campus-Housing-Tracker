#!/usr/bin/env bash
# Run scripts/k6/k6-smoke-gateway.js from inside the cluster (grafana/k6 Job). Requires api-gateway Service.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
JS="$REPO_ROOT/scripts/k6/k6-smoke-gateway.js"
JOB="k6-smoke-$(date +%s)"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }
test -f "$JS" || { echo "missing $JS" >&2; exit 1; }

if ! kubectl get deployment api-gateway -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  echo "⚠️  No deployment/api-gateway — skipping k6 smoke"
  exit 0
fi

kubectl create configmap "${JOB}-script" -n "$NS" --from-file="smoke.js=$JS" --dry-run=client -o yaml \
  | kubectl apply -f - --request-timeout=30s

cleanup() {
  kubectl delete job "$JOB" -n "$NS" --ignore-not-found --request-timeout=30s >/dev/null 2>&1 || true
  kubectl delete configmap "${JOB}-script" -n "$NS" --ignore-not-found --request-timeout=30s >/dev/null 2>&1 || true
}
trap cleanup EXIT

cat <<YAML | kubectl apply -f - --request-timeout=30s
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  namespace: ${NS}
spec:
  ttlSecondsAfterFinished: 120
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:0.52.0
          args: ["run", "/scripts/smoke.js"]
          volumeMounts:
            - name: scripts
              mountPath: /scripts
              readOnly: true
      volumes:
        - name: scripts
          configMap:
            name: ${JOB}-script
YAML

if ! kubectl wait --for=jsonpath='{.status.succeeded}'=1 "job/${JOB}" -n "$NS" --timeout=180s 2>/dev/null; then
  echo "❌ k6 smoke job did not succeed" >&2
  kubectl describe "job/${JOB}" -n "$NS" --request-timeout=30s >&2 || true
  kubectl logs "job/${JOB}" -n "$NS" --all-containers=true --tail=200 --request-timeout=30s >&2 || true
  exit 1
fi
echo "✅ k6 smoke job succeeded"
