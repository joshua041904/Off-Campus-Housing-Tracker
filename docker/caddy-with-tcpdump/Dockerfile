# Caddy built with xcaddy for proper HTTP/3 (QUIC) support, plus tcpdump for rotation-suite packet capture.
# TLS/mTLS at edge; use with LoadBalancer (infra/k8s/loadbalancer.yaml) to avoid hostPort and anti-affinity.
# Build: docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile .
# k3d: k3d image import caddy-with-tcpdump:dev -c off-campus-housing-tracker

# --- builder: xcaddy builds Caddy with default modules (includes HTTP/3) ---
FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
WORKDIR /build
# Build Caddy with xcaddy (no extra plugins; HTTP/3 is built-in). Optional: --with for custom plugins.
ENV CADDY_VERSION=v2.8.4
RUN xcaddy build "${CADDY_VERSION}" --output /usr/bin/caddy

# --- runtime: Caddy + tcpdump ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tcpdump libcap
RUN setcap cap_net_bind_service=+ep /usr/bin/true 2>/dev/null || true
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy 2>/dev/null || true

EXPOSE 443 443/udp 2019 5000
VOLUME ["/config/caddy", "/data/caddy"]
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
