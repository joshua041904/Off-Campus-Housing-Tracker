# Media ↔ API Gateway ↔ k6 — diagnostics report

**Date:** 2026-03-22  
**Cluster context (when captured):** `colima`  
**Purpose:** Document TLS/SAN conclusions, live checks, and why k6 “media” smoke can fail **without** being a gRPC/mTLS mystery.

**Architecture (normative):** The gateway **requires** `MEDIA_HTTP` because it proxies **`/api/media/*` and `/media/*` over HTTP** to `media-service:4018` — not via gRPC. See [`ENGINEERING.md`](../ENGINEERING.md) → **Service Communication Patterns** → *Why `MEDIA_HTTP` exists* and *Event-driven contracts* (`proto/` RPC vs `proto/events/` Kafka).

**Runbook:** [`Runbook.md`](../Runbook.md) → **k6, macOS, MEDIA_HTTP, HAProxy (items 92-97)** — condensed troubleshooting index (k6 keychain, `k6 -e`, HAProxy path, `ECONNREFUSED :4018`, JSON log noise, rebuild/rollout).

---

## 1. TLS / SAN status (confirmed)

Leaf used by `service-tls` / `och-service-tls` includes:

- `DNS:*.off-campus-housing-tracker.svc.cluster.local`
- Explicit service names (api-gateway, auth-service, …)
- **Wildcard rule:** `*.off-campus-housing-tracker.svc.cluster.local` matches **exactly one** leftmost label → **`media-service.off-campus-housing-tracker.svc.cluster.local` is valid.**

**Conclusion:** For paths that verify the server as that DNS name, this is **not** a SAN mismatch and **not** a rotation-only identity bug *by itself*.

**Caveat:** The in-pod `grpc-health-probe` uses `-tls-server-name=localhost` while the gateway gRPC client uses the **full service DNS** via `grpc.ssl_target_name_override` (`services/common/src/grpc-clients.ts`). Probes passing does **not** prove gateway gRPC would pass—**but** with the SAN list above, gRPC verification to the service name **should** succeed.

---

## 2. What k6 “media health” actually hits (critical)

`scripts/load/k6-media-health.js` does **HTTP**:

- `GET {BASE_URL}/api/media/healthz` (or `/media/healthz` depending on base)

That goes:

**k6 → edge TLS → api-gateway:4020 → HTTP reverse proxy → `MEDIA_HTTP` (default `http://media-service…:4018`) → `/healthz`**

It does **not** open a gRPC channel to `:50068`.

Source: `services/api-gateway/src/server.ts` — `/media/healthz` and `/api/media/healthz` use `createProxyMiddleware` to `MEDIA_HTTP`, not `createMediaClient`.

So hypotheses centered on **gateway → media gRPC** are **misaligned** with **k6-media-health.js** specifically.

---

## 3. Live checks run (this workspace / cluster)

### 3.1 Pods

```text
api-gateway-6c9fc5dd75-mmhzs   1/1 Running
media-service-647cd5bcc9-lw22p 1/1 Running
```

### 3.2 From **inside** `api-gateway` pod: TCP to media **HTTP** port

Command (conceptually):

`node -e "http.get('http://media-service.off-campus-housing-tracker.svc.cluster.local:4018/healthz', …)"`

**Result:**

```text
Error: connect ECONNREFUSED 10.43.71.100:4018
```

So the Service routes `4018` → pod `targetPort: http` (4018), but **nothing is accepting connections** on that port in the media container.

### 3.3 Root cause in **source**

`services/media-service/src/server.ts` **only** called `startGrpcServer` — **no HTTP server** on `HTTP_PORT` / 4018.

K8s manifest still exposes container port `4018` and Service port `4018`, and the gateway still proxies to that URL → **consistent ECONNREFUSED** and k6 failures through the gateway.

### 3.4 `media-service` logs (tail)

Startup only:

- gRPC on 50068, strict mTLS, listening — **no HTTP listen line** (before fix).

### 3.5 `api-gateway` logs (filtered tail)

Many lines like:

```text
[gw] Unhandled error: Expected property name or '}' in JSON at position 1
```

That is **Express JSON body parsing** / bad JSON on **some** route—not proof of media TLS. Treat as a **separate** issue (malformed `Content-Type: application/json` bodies).

---

## 4. Where “gRPC under load” still matters

Other flows (future or different tests) may use **gRPC** to `media-service:50068` with mTLS. That path is separate from **k6-media-health HTTP**.

If those fail, use:

```bash
kubectl logs -n off-campus-housing-tracker deploy/api-gateway -f | grep -Ei 'UNAVAILABLE|DEADLINE|grpc|14 '
kubectl logs -n off-campus-housing-tracker deploy/media-service -f
```

Run **while** reproducing load.

---

## 5. Remediation applied in repo (HTTP listen)

To align runtime with **gateway + k6**:

- Added a minimal **HTTP** listener on `HTTP_PORT` (default **4018**) with **`GET /healthz`** (and `/health`) using DB connectivity consistent with lightweight checks.
- `server.ts` now starts **both** HTTP and gRPC.

After rebuild/redeploy of `media-service`, re-verify from gateway pod:

```bash
kubectl exec -n off-campus-housing-tracker deploy/api-gateway -- \
  node -e "require('http').get('http://media-service.off-campus-housing-tracker.svc.cluster.local:4018/healthz',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))}).on('error',e=>console.error(e));"
```

Expect **200** and a small JSON body.

---

## 6. Quick reference commands

| Goal | Command |
|------|--------|
| Gateway logs | `kubectl logs -n off-campus-housing-tracker deploy/api-gateway --tail=400` |
| Media logs | `kubectl logs -n off-campus-housing-tracker deploy/media-service --tail=200` |
| SAN inspect (in media pod) | `kubectl exec -n off-campus-housing-tracker deploy/media-service -- openssl x509 -in /etc/certs/tls.crt -noout -text \| grep -A2 'Subject Alternative Name'` |
| Probe gateway→media HTTP | See §5 |

---

## 7. Summary

| Question | Answer |
|----------|--------|
| HAProxy → media direct? | No — HAProxy → api-gateway only. |
| k6 media health = gRPC to 50068? | **No** — **HTTP** `/api/media/healthz` → gateway → **4018**. |
| SAN OK for `media-service…`? | **Yes** (wildcard + explicit names). |
| Observed failure mode (live)? | **ECONNREFUSED :4018** — **no HTTP server** in media process. |
| Next if HTTP fixed but errors remain? | Gateway logs during load; Node channel keepalive tuning; separate JSON parse errors. |
