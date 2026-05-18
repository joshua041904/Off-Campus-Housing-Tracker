# Envoy with tcpdump for packet capture (rotation-suite, ensure-tcpdump-in-capture-pods).
# Base: envoyproxy/envoy (Ubuntu). Same entrypoint as upstream; tcpdump for capture on port 10000.
# Build: docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile .
# k3d: k3d image import envoy-with-tcpdump:dev -c off-campus-housing-tracker
#
# Default base uses mirror.gcr.io (Docker Hub pull-through) to reduce anonymous hub 429s.
# Override: --build-arg ENVOY_IMAGE=docker.io/envoyproxy/envoy:v1.28-latest

# Use default (non-distroless) tag so we have a package manager for tcpdump.
ARG ENVOY_IMAGE=mirror.gcr.io/envoyproxy/envoy:v1.28-latest
FROM ${ENVOY_IMAGE}
USER root
COPY scripts/docker/debian-apt-update.sh /tmp/debian-apt-update.sh
RUN chmod +x /tmp/debian-apt-update.sh && \
  /tmp/debian-apt-update.sh && \
  apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Min-ValidTime=0 install -y --no-install-recommends tcpdump && \
  rm -rf /var/lib/apt/lists/*
# Keep image default user (entrypoint unchanged)
