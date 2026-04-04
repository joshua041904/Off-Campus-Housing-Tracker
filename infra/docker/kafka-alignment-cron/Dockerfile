# Image for in-cluster Kafka alignment checks (CronJob). Build from repo root:
#   docker build -f infra/docker/kafka-alignment-cron/Dockerfile -t kafka-alignment-cron:latest .
#
# Expects kubeconfig via in-cluster ServiceAccount (no COPY of kubeconfig).
FROM alpine:3.19

ARG KUBECTL_VERSION=v1.29.0
ARG TARGETARCH=amd64
RUN apk add --no-cache bash curl openssl python3 ca-certificates \
  && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
  && chmod +x /usr/local/bin/kubectl

WORKDIR /workspace
COPY scripts /workspace/scripts
RUN find /workspace/scripts -type f -name '*.sh' -exec chmod +x {} \;

ENV REPO_ROOT=/workspace
# Non-destructive suite: runtime re-check + TLS verifier; test1 skips full verify-kafka-cluster.
CMD ["/bin/bash", "-lc", "set -euo pipefail; /workspace/scripts/kafka-runtime-sync.sh --check-only; KAFKA_ALIGNMENT_SKIP_TEST1_VERIFY=1 KAFKA_ALIGNMENT_TEST_MODE=0 /workspace/scripts/tests/kafka-alignment-suite.sh"]
