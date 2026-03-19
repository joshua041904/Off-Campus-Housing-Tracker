# caddy-with-tcpdump

Caddy image built with **xcaddy** for proper **HTTP/3 (QUIC)** support, plus **tcpdump** for rotation-suite packet capture. Use with **TLS/mTLS** at the edge and **LoadBalancer** (no hostPort) so two Caddy pods can run on one node without anti-affinity issues.

## Build

From repo root:

```bash
docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile .
```

k3d: load into cluster after build:

```bash
k3d image import caddy-with-tcpdump:dev -c off-campus-housing-tracker
```

## Deploy

Use LoadBalancer so Caddy does not need hostPort (2 replicas on one node):

```bash
CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh
```

That applies:

- **Deployment**: `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` (2 replicas, no hostPort)
- **Service**: `infra/k8s/loadbalancer.yaml` (type: LoadBalancer, MetalLB)

Ensure TLS secrets exist in `ingress-nginx`: `off-campus-housing-local-tls`, `dev-root-ca` (e.g. `./scripts/strict-tls-bootstrap.sh` or `./scripts/setup-tls-and-edge.sh`).

## Why xcaddy

Caddy is built with **xcaddy** so the binary includes first-class HTTP/3 (QUIC) support and matches the official build layout. The Dockerfile does not add plugins; HTTP/3 is built-in. You can extend with `xcaddy build --with <module>` in the Dockerfile if needed.
