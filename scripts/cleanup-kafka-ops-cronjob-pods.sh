#!/usr/bin/env bash
# Remove finished Jobs (and their pods) created by Kafka ops CronJobs so the namespace stays tidy.
# Pod label job-name is the *Job* name (e.g. kafka-quorum-check-29582156), not the CronJob name,
# so we delete finished Jobs using batch.kubernetes.io/cronjob-name.
#
# Canonical manifests (infra/ops/*.yaml) already set successfulJobsHistoryLimit: 1,
# failedJobsHistoryLimit: 1, and ttlSecondsAfterFinished on the Job template — re-apply if needed:
#   kubectl apply -k infra/ops/
#
# Usage: ./scripts/cleanup-kafka-ops-cronjob-pods.sh
#   HOUSING_NS=off-campus-housing-tracker (default)
set -euo pipefail

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi

delete_finished_jobs_for_cronjob() {
  local cronjob_name="$1"
  local names
  names="$(kubectl get jobs -n "$HOUSING_NS" \
    -l "batch.kubernetes.io/cronjob-name=${cronjob_name}" \
    -o jsonpath='{range .items[?(@.status.completionTime)]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"
  if [[ -z "${names//[$'\n']/}" ]]; then
    echo "No finished jobs for CronJob/${cronjob_name} (or label not present on older clusters)."
    return 0
  fi
  while IFS= read -r job; do
    [[ -z "$job" ]] && continue
    echo "Deleting job/$job (CronJob/$cronjob_name)..."
    kubectl delete job "$job" -n "$HOUSING_NS" --ignore-not-found
  done <<< "$names"
}

for cj in kafka-quorum-check kafka-dns-auto-remediator; do
  echo "=== Cleanup finished jobs for $cj ==="
  delete_finished_jobs_for_cronjob "$cj"
done

echo "Done."
