# TLS + Edge Setup (Idiot-Proof Guide)

This guide gets **Caddy** (TLS edge), **Envoy** (gRPC proxy), and **namespaces** in place so anyone on the team can run the stack without wrestling with certs manually.

## What you get

- **Namespaces:** `ingress-nginx` (Caddy), `envoy-test` (Envoy), `off-campus-housing-tracker` (app pods)
- **Certs:** Dev CA + Caddy leaf (`off-campus-housing.local`) + Envoy client cert + service certs — all generated for you
- **TLS secrets:** Loaded into the cluster for Caddy, Envoy, and backends (mTLS)
- **Caddy:** 2 pods in `ingress-nginx`, built with **xcaddy** (HTTP/3 support) and **tcpdump**
- **Envoy:** 1 pod in `envoy-test`, with **tcpdump** for packet capture

## Prerequisites

- **kubectl** — cluster running (e.g. Colima or k3d)
- **Docker** — for building Caddy and Envoy images
- **openssl** — for cert generation (usually already on Mac/Linux)

## One command (recommended)

From the **repo root**:

```bash
./scripts/setup-tls-and-edge.sh
```

This runs, in order:

1. Create namespaces: `ingress-nginx`, `envoy-test`, `off-campus-housing-tracker`
2. Generate all certs (CA, Caddy leaf, Envoy client, services) — **no manual cert steps**
3. Load TLS secrets into the cluster (`strict-tls-bootstrap`)
4. Build **caddy-with-tcpdump** (xcaddy + HTTP/3 + tcpdump) and **envoy-with-tcpdump** images
5. Roll out Caddy (2 replicas) in `ingress-nginx` — LoadBalancer when Colima+MetalLB, else NodePort
6. Apply Envoy (1 replica) in `envoy-test`
7. Patch Envoy to use the tcpdump image; Caddy deploy already uses `caddy-with-tcpdump:dev`
8. Wait for rollouts and print a summary

If you already have the tcpdump images built and don’t want to rebuild:

```bash
SKIP_BUILD_TCPDUMP=1 ./scripts/setup-tls-and-edge.sh
```

## Namespace layout

| Namespace                     | Purpose |
|------------------------------|--------|
| **ingress-nginx**            | Caddy (2 pods). TLS termination, HTTP/3, routes to Envoy and web. |
| **envoy-test**               | Envoy (1 pod). gRPC proxy; Caddy sends h2c to Envoy:10000; Envoy talks mTLS to backends. |
| **off-campus-housing-tracker** | App services (auth, listings, booking, messaging, etc.). Envoy routes here. |

Caddy and Envoy both use **tcpdump** in their images so packet-capture and rotation tests don’t need to install it at runtime.

## If something goes wrong

- **“Cannot read file certs/off-campus-housing.local.crt”**  
  Run the one script above; it generates those certs in step 2. If you ran an older flow, run `./scripts/dev-generate-certs.sh` then `./scripts/strict-tls-bootstrap.sh`.

- **Caddy/Envoy ImagePullBackOff**  
  The script builds `caddy-with-tcpdump:dev` and `envoy-with-tcpdump:dev` locally. For Colima, the cluster uses the same Docker daemon, so the images are visible. For k3d, import them:  
  `k3d image import caddy-with-tcpdump:dev envoy-with-tcpdump:dev -c <cluster-name>`

- **Envoy mTLS to backends failing**  
  Ensure Envoy client cert exists: `./scripts/generate-envoy-client-cert.sh` (requires `certs/dev-root.key` from `dev-generate-certs.sh`). Then re-run `./scripts/strict-tls-bootstrap.sh`.

## Manual steps (optional)

If you prefer to run steps yourself:

1. **Certs**  
   `./scripts/dev-generate-certs.sh`  
   Then (for Envoy): `./scripts/generate-envoy-client-cert.sh`

2. **Secrets**  
   `./scripts/strict-tls-bootstrap.sh`

3. **Caddy**  
   `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh`  
   (Use `CADDY_USE_LOADBALANCER=0` if you don’t have MetalLB.)

4. **Envoy**  
   `kubectl apply -k infra/k8s/base/envoy-test`

5. **tcpdump images**  
   `./scripts/ensure-caddy-envoy-tcpdump.sh`  
   (Builds both images and patches the deployments.)

## Caddy and HTTP/3

Caddy is built with **xcaddy** in `docker/caddy-with-tcpdump/Dockerfile`. That build includes first-class **HTTP/3 (QUIC)** support; no extra plugins are required. The image also includes **tcpdump** for packet capture. See `docker/caddy-with-tcpdump/README.md` for build and deploy details.

### One-command HTTP/3 verification

To confirm HTTP/3 is working end-to-end (Caddy built with h3, UDP 443 exposed, alt-svc, and `curl --http3`):

```bash
./scripts/verify-http3-edge.sh
```

This checks:

1. **Caddy built with h3** — `kubectl exec -n ingress-nginx deploy/caddy-h3 -- caddy version` (must show `h3`).
2. **UDP 443 on Service** — `kubectl get svc caddy-h3 -n ingress-nginx` and `-o yaml` must show port 443 with `protocol: UDP`.
3. **alt-svc header** — `curl -I https://off-campus-housing.local` must include `alt-svc: h3=":443"`.
4. **QUIC handshake** — `curl -I --http3 https://off-campus-housing.local` must return `HTTP/3 200`. The script uses **Homebrew curl** when available (`/opt/homebrew/bin/curl` or `/usr/local/bin/curl`) so the `--http3` test runs; install with `brew install curl` if needed.
5. **Optional:** Run `tcpdump -i any udp port 443` inside a Caddy pod while loading the site to see QUIC traffic.

**Important:** In this repo, Caddy runs in namespace **ingress-nginx** with deployment name **caddy-h3** (not `off-campus-housing` / `deploy/caddy`). The script uses **CADDY_NS** (default `ingress-nginx`). If you have `NS=record-platform` in your environment from another project, either unset it or run `CADDY_NS=ingress-nginx ./scripts/verify-http3-edge.sh`. **MetalLB** is installed when you run **`./scripts/setup-new-colima-cluster.sh`**; if the LoadBalancer service has EXTERNAL-IP `<pending>`, run `./scripts/verify-metallb-and-traffic-policy.sh` to verify pool/L2.

**ImagePullBackOff:** If Caddy pods can't pull `caddy-with-tcpdump:dev`, build and load the image into Colima: **`./scripts/load-caddy-image-colima.sh`**. Then re-run the verify script.

**EXTERNAL-IP &lt;pending&gt; / "pool has no addresses":** MetalLB is installed by **`./scripts/setup-new-colima-cluster.sh`**, but the IP pool must be in the **Colima VM subnet** (e.g. 192.168.64.x or 192.168.5.x). If the pool is empty or wrong subnet, the LoadBalancer never gets an IP. Fix in one go: **`./scripts/apply-metallb-pool-colima.sh`** — it auto-detects the VM subnet, re-applies the pool and L2, and recreates the `caddy-h3` service so MetalLB assigns an IP. Then run **`./scripts/verify-http3-edge.sh`** again.
