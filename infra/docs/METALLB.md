# MetalLB load balancing

MetalLB provides a network load balancer for bare-metal and local Kubernetes (e.g. Colima k3s) so `LoadBalancer` services get an external IP.

## Quick install (Colima k3s)

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml
```

Then create a small address pool so `LoadBalancer` services can get an IP in your local range, e.g.:

```yaml
# metallb-addresspool.yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default
  namespace: metallb-system
spec:
  addresses:
    - 192.168.64.240/28   # adjust to your Colima/Docker bridge range
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default
  namespace: metallb-system
spec:
  ipAddressPools:
    - default
```

Apply:

```bash
kubectl apply -f metallb-addresspool.yaml
```

## Finding a suitable range

- Colima node is often `192.168.5.1`; use same subnet for the pool (e.g. `192.168.5.240/28`). Check with `colima ssh -- ip addr`.
- Repo pool config: **infra/k8s/metallb/ipaddresspool.yaml** (default `192.168.5.240/28`). Override with `METALLB_POOL="192.168.64.240-192.168.64.250" ./scripts/install-metallb.sh`.
- Use a small CIDR (e.g. /28 = 16 IPs) that does not overlap with existing DHCP.

## Webhook and pool apply

Pool and L2 apply call MetalLB’s validation webhook. If you see **"endpoints webhook-service not found"**, the controller isn’t ready yet. **scripts/install-metallb.sh** waits for webhook endpoints before applying pool. If you apply pool/L2 manually, wait until `kubectl get ep -n metallb-system webhook-service` shows addresses, then apply.

## Later: production

For real load balancing in production, use your cloud LB (e.g. AWS NLB/ALB, GCP LB) or keep MetalLB with a larger pool and BGP if you have bare metal.
