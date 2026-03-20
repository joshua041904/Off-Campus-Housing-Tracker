# Envoy with tcpdump for packet capture (rotation-suite, ensure-tcpdump-in-capture-pods).
# Base: envoyproxy/envoy (Ubuntu). Same entrypoint as upstream; tcpdump for capture on port 10000.
# Build: docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile .
# k3d: k3d image import envoy-with-tcpdump:dev -c off-campus-housing-tracker

# Use default (non-distroless) tag so we have a package manager for tcpdump.
FROM envoyproxy/envoy:v1.28-latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends tcpdump \
  && rm -rf /var/lib/apt/lists/*
# Keep image default user (entrypoint unchanged)
