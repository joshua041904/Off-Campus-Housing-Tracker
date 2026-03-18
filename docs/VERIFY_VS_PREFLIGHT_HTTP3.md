# MetalLB Verify vs Preflight: Why Results Differ (HTTP/3)

## What runs where

| Run | When | What happens |
|-----|------|--------------|
| **Standalone** | `./scripts/verify-metallb-and-traffic-policy.sh` | Full MetalLB + traffic check. Step 3c2 (Caddy) is **not** run here — Caddy is assumed already deployed. Steps: namespace, controller, speaker, pool, L2, LB services, in-cluster curl, host reachability (no-sudo 127.0.0.1:8443 on Colima), then **HTTP/3** (step 6). |
| **Preflight** | `./scripts/run-preflight-scale-and-all-suites.sh` | Step **3c2** applies Caddy deploy + LoadBalancer service **before** step **3c1b**. Step 3c1b runs the **same** `verify-metallb-and-traffic-policy.sh` (optionally with `SKIP_METALLB_ADVANCED=1`). Later, step **4f** runs `verify-caddy-http3-in-cluster.sh` (HTTP/3 via MetalLB IP from inside the cluster). |

So: **preflight runs verify in the same order as a standalone run** (3c2 → wait for Caddy → 3c1b verify). The **script** is the same; the **environment** (what’s up before/after) can differ.

## Why HTTP/3 might “work” in one place and not the other

1. **Same script, same result**  
   If you run **only** verify (standalone) and then run **only** the verify step inside preflight (after 3c2), you should get the same HTTP/3 pass/fail **for that step**, because it’s the same script and same checks.

2. **Where HTTP/3 is checked**  
   - **Verify script (step 6):**  
     - Tries HTTP/3 to LB IP from **inside the VM** (in-VM curl).  
     - Then tries HTTP/3 to **127.0.0.1:8443** (no-sudo forward) from the **host**.  
     On Colima, if the host path uses `setup-lb-ip-host-access-no-sudo.sh`, both **TCP and UDP** 8443 → VM NodePort are forwarded. If the **VM** NodePort does not expose **UDP** for 443, or the host’s UDP path is broken, step 6 reports **HTTP/3 failed**.  
   - **Preflight 4f:**  
     Runs **in-cluster** HTTP/3 to the MetalLB IP (`verify-caddy-http3-in-cluster.sh`). That does **not** use the host’s 127.0.0.1:8443 path; it uses a pod in the cluster curling the LB IP. So:
     - **Verify** can fail on step 6 (host 127.0.0.1:8443 HTTP/3).
     - **Preflight 4f** can still pass (in-cluster → LB IP HTTP/3).

   So “results differ” can mean: **verify fails HTTP/3 on the host path**, while **preflight 4f passes in-cluster HTTP/3**.

3. **Order and timing**  
   If preflight runs 3c1b **before** Caddy is ready (e.g. old order), verify would see no caddy-h3 / no LB IP and fail. With the **fix** (3c2 before 3c1b), verify in preflight sees the same state as a standalone run **after** Caddy is deployed. So the only remaining differences are (a) in-cluster vs host path for HTTP/3, and (b) any later steps (e.g. route flap, BGP) that might change the cluster before a second run.

## How to get HTTP/3 working (consistent results)

- **In-cluster HTTP/3 (preflight 4f):**  
  Use MetalLB and run `verify-caddy-http3-in-cluster.sh` with `TARGET_IP=<LB_IP>`. No host UDP needed.

- **Host HTTP/3 (verify step 6 / manual curl):**  
  - **Preferred:** Use **bridged** Colima so the Mac can reach the LB IP directly (UDP to 192.168.x.x:443):  
    `./scripts/colima-start-k3s-bridged-clean.sh`  
    then: `curl -k --http3-only https://<LB_IP>/_caddy/healthz`  
  - **Or** ensure the no-sudo forward is running and that the **VM** NodePort exposes **UDP** for 443:  
    `./scripts/setup-lb-ip-host-access-no-sudo.sh`  
    then: `NGTCP2_ENABLE_GSO=0 curl --http3-only -k --resolve record.local:8443:127.0.0.1 https://record.local:8443/_caddy/healthz`  
  - If step 6 still fails: run in-VM:  
    `colima ssh -- curl -k --http3-only https://<LB_IP>/_caddy/healthz`  
    (VM curl must be built with HTTP/3/ngtcp2 for this to work.)

- **Why “the latter don’t work”:**  
  If “the latter” means **preflight**: preflight runs the **same** verify script in 3c1b; if HTTP/3 fails there, it’s the same failure as standalone (usually host UDP path). If “the latter” means **HTTP/3 in preflight** (e.g. 4e/4f): 4e is host NodePort (often broken on macOS); 4f is in-cluster and should work if Caddy and MetalLB are healthy. Compare the **exact** step and log line (e.g. “3c1b” vs “4f”) to see which path is failing.

### Confirm host vs in-cluster QUIC (manual curl)

To prove that failure is the **host → Colima UDP path** and not Caddy/MetalLB:

```bash
curl --http3 -v \
  --resolve record.local:443:192.168.64.240 \
  --cacert certs/dev-root.pem \
  https://record.local/_caddy/healthz
```

If this succeeds while host k6 HTTP/3 fails (e.g. "context deadline exceeded", 0% success), the issue is the host k6 + Colima UDP path, not the platform. In that case, treat **in-cluster k6** and **pod-level capture (L2 Caddy)** as authoritative for QUIC; host HTTP/3 is optional diagnostic only on Colima.

## Quick comparison

| Check | Verify script | Preflight |
|-------|----------------|-----------|
| Caddy + LB IP | Assumed up | 3c2 applies Caddy before 3c1b |
| 3c1b MetalLB verify | Full run | Same script (optionally SKIP_METALLB_ADVANCED=1) |
| HTTP/3 (host 127.0.0.1:8443) | Step 6 | Same in 3c1b |
| HTTP/3 in-cluster | Not run | Step 4f (`verify-caddy-http3-in-cluster.sh`) |

So: **same verify script → same 3c1b result**. Differences are (1) 4f in-cluster HTTP/3 only in preflight, and (2) host HTTP/3 (step 6) can fail on Colima no-sudo path while in-cluster HTTP/3 works. Use bridged Colima or in-cluster checks for reliable HTTP/3.
