# MetalLB config (k3d and Colima k3s)

**Primary Colima flow:** See **docs/COLIMA-K3S-METALLB-PRIMARY.md**. Use `./scripts/colima-start-k3s-bridged.sh`, then `./scripts/install-metallb-colima.sh` (sets pool from `METALLB_POOL`), then `./scripts/bring-up-colima-cluster.sh`. Real L2, no nested Docker.

- **ipaddresspool.yaml** — Pool of IPs for `LoadBalancer` services. Contains `$METALLB_POOL`; substituted by `install-metallb-colima.sh`. For Colima use a range in your LAN (e.g. `METALLB_POOL=192.168.106.240-192.168.106.250`); find VM IP with `colima ssh -- ip addr`.
- **l2advertisement.yaml** — L2 advertisement for that pool.
- **frr-config.yaml** — ConfigMap for FRR (BGP listen range for pod CIDR 10.42.0.0/16).
- **frr-deploy.yaml** — FRR Deployment + Service (port 179) for in-cluster BGP peer.
- **bgppeer.yaml** — BGPPeer (peerAddress substituted by install script with FRR Service ClusterIP).
- **bgpadvertisement.yaml** — BGPAdvertisement for `default-pool`; apply after BGPPeer.

## Finding your Colima range

```bash
colima ssh -- ip addr
```

Pick a small range (e.g. /28 = 16 IPs) in the same subnet as the Colima bridge (often `192.168.106.x` or `192.168.64.x`) and not used by DHCP. Override when installing:

```bash
METALLB_POOL="192.168.64.240-192.168.64.250" ./scripts/install-metallb.sh
```

Or edit `ipaddresspool.yaml` and change `addresses` then run `./scripts/apply-metallb-pool-and-caddy-service.sh` (or preflight with `METALLB_ENABLED=1`).

## Apply

After MetalLB is installed and controller is ready:

```bash
kubectl apply -f infra/k8s/metallb/ipaddresspool.yaml -f infra/k8s/metallb/l2advertisement.yaml
kubectl apply -f infra/k8s/loadbalancer.yaml   # Caddy LoadBalancer service (EXTERNAL-IP from pool)
```

Or use `./scripts/install-metallb.sh` (installs MetalLB and applies pool from this dir if present) or `./scripts/apply-metallb-pool-and-caddy-service.sh`. **Caddy as LoadBalancer:** Deploy Caddy with `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh` so the service uses `caddy-h3-service-loadbalancer.yaml`. Then `kubectl -n ingress-nginx get svc caddy-h3` shows an EXTERNAL-IP from the pool. **Verification (MetalLB IP only, no socat on Colima):** `./scripts/verify-metallb-and-traffic-policy.sh` checks HTTP/1.1, HTTP/2, and HTTP/3 via the LoadBalancer IP. On Colima ensure `METALLB_POOL` is on the VM network (e.g. `192.168.64.240-192.168.64.250`) so the host can reach the LB IP directly.

**BGP mode (FRR + BGPPeer):** After MetalLB is installed, **`install-metallb-colima.sh`** checks for an existing BGPPeer; if none is present, it runs **`install-metallb-frr-bgp.sh`** to deploy FRR and apply BGPPeer + BGPAdvertisement. You can also run it manually:

```bash
./scripts/install-metallb-frr-bgp.sh
```

This builds the FRR image (`infra/k8s/metallb/frr/Dockerfile`), deploys FRR in `metallb-system`, and applies **BGPPeer** + **BGPAdvertisement** so the MetalLB speaker peers with FRR. L2 (ARP) stays in place; BGP is added. All verification (MetalLB IP, HTTP/3, BGP session) uses the LoadBalancer IP: `./scripts/verify-metallb-and-traffic-policy.sh` or `kubectl -n metallb-system logs -l component=speaker --tail=50 | grep -i bgp`.

**External BGP router:** If you have an external router instead of in-cluster FRR, set `peerAddress` (and optionally `myASN`/`peerASN`) in `bgppeer.yaml`, then apply `bgppeer.yaml` and `bgpadvertisement.yaml` manually. See **docs/METALLB_ADVANCED.md**.

## Traffic policy and priority (multi-node / scale)

For **priority evaluation** (which nodes announce L2) and **traffic policy at scale** (byte-level encoding, hashcode tricks), see **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`**. The `l2advertisement.yaml` includes commented `nodeSelector` for use when the cluster has 2–3 nodes.
