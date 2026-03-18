# Local FRR image — no external registry needed. Works on amd64 and arm64 (Apple Silicon).
# Build: docker build -t frr-metallb:local -f infra/k8s/metallb/frr/Dockerfile --build-arg ALPINE_BASE=alpine:3.19 .
# If Docker Hub times out: docker pull alpine:3.19 (or alpine:latest) then re-run install script.
ARG ALPINE_BASE=alpine:3.19
FROM ${ALPINE_BASE}
RUN apk add --no-cache frr tini
RUN mkdir -p /var/run/frr && chown -R frr:frr /etc/frr /var/run/frr 2>/dev/null || true
# Enable zebra and bgpd (Alpine daemons file)
RUN sed -i 's/zebra=no/zebra=yes/' /etc/frr/daemons 2>/dev/null || true \
 && sed -i 's/bgpd=no/bgpd=yes/' /etc/frr/daemons 2>/dev/null || true
EXPOSE 179
ENTRYPOINT ["/sbin/tini", "--"]
# Alpine's frr package has watchfrr (not frrstart). Foreground: watchfrr zebra bgpd
CMD ["/usr/lib/frr/watchfrr", "zebra", "bgpd"]
