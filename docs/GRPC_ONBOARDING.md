# gRPC service development (OCH)

Goal: ship handlers that **match the proto**, are **testable**, and fail with **correct gRPC status codes**—aligned with strict TLS/mTLS and Kubernetes probes in this repo.

**Who this is for:** engineers implementing domain services (listings, messaging, auth patterns, etc.) after platform work has defined protos and infra.

---

## 1. Workflow (incremental)

1. Read the **proto** for your service (e.g. `proto/listings.proto` → `listings.ListingsService`).
2. Implement **one RPC** end-to-end (e.g. `CreateListing`): validation → DB → response mapping.
3. Run locally: **grpcurl** (or a small script) against `localhost` or port-forward; use **mTLS** flags if the server enforces TLS (see Runbook / service README).
4. Document **how to run + how to test** in that service’s `README.md`.
5. Add at least one **reproducible** check: grpcurl snippet **or** a Vitest/integration test (same bar as `messaging-service` / `media-service`).
6. Open PR; use **`docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt`** (plain-text comments to paste). Optionally copy to `docs/PR_REVIEW_GRPC_HANDLER_PASTE.txt` locally — that path is **gitignored** for your own wording.

---

## 2. Handler rules

| Rule | Detail |
|------|--------|
| Contract | Response shape and field semantics must match the **generated types and proto**—no extra fields on the wire, no silently dropped required inputs. |
| Happy path | Persist and return what the DB/schema actually stores; map DB rows → `*Response` messages explicitly. |
| Errors | Map validation failures and dependency failures to **`grpc.status`** (see below)—never `console.error` only. |
| UNIMPLEMENTED | OK for RPCs not built yet; return `UNIMPLEMENTED` with a clear message until implemented. |

---

## 3. Error handling (`@grpc/grpc-js`)

Use meaningful status codes so gateways and other services can reason about failures:

| Situation | Code | Notes |
|-----------|------|--------|
| Missing/invalid arguments, bad formats | `InvalidArgument` | Include a short `details` string where helpful. |
| Row not found | `NotFound` | Use for “listing id does not exist,” not for bad syntax. |
| Constraint violations, unexpected DB errors | `Internal` | Log the real error server-side; avoid leaking SQL in the client message. |
| Not yet implemented | `UNIMPLEMENTED` | Prefer this over empty stubs that hang or return garbage. |

Import pattern (Node):

```ts
import { status } from '@grpc/grpc-js'
import * as grpc from '@grpc/grpc-js'
// e.g. callback(new Error('msg'), { code: status.INVALID_ARGUMENT })
```

---

## 4. Database

- Follow the **domain schema** (e.g. `listings.listings` for listings-service). If the proto field is required for product reasons, enforce it in code **or** document DB `NOT NULL` + defaults.
- Avoid inventing columns or defaults that are not in migrations/schema—the service and DB must stay in lockstep.
- Use connection settings from env / `app-config` patterns used by other services (`PG_HOST`, port per DB, e.g. listings **5442** on host compose).

---

## 5. Testing (required minimum)

Pick **at least one**:

- **A. grpcurl** — document exact command, TLS flags (`-cacert`, client cert/key if mTLS), port (**50062** for listings gRPC in-cluster per architecture docs), and **example JSON** for `-d` plus what success looks like.
- **B. Integration test** — Vitest (or equivalent) calling the handler with a test DB or container, same as `services/messaging-service/tests` / `services/media-service/tests`.

Preflight and housing scripts often assume **edge TLS** and **strict** checks; local handler tests should still be runnable with `pnpm test` in the service.

---

## 6. Logging and observability

- Log **one structured line** per RPC at info level: service name, method, correlation id if present, outcome (ok / error code).
- On failure, log **enough** to debug (e.g. listing_id, not secrets) without dumping full request bodies in production.

---

## 7. Proto loading and registration

- Load the **same** `.proto` files the cluster mounts (see `infra/k8s/base/config` and `kustomization.yaml` for ConfigMap keys).
- Register **health** (`grpc.health.v1`) per platform standard—readiness probes use **grpc-health-probe** with mTLS where deploys require it.
- Package names in code must match proto (`package listings;` → `listings.ListingsService`).

---

## 8. README requirement (per service)

Each gRPC-owning service README should include:

- How to **run** locally or in Docker.
- Default **ports** (HTTP + gRPC) for OCH.
- **grpcurl** example **or** pointer to `pnpm test`.
- Link back to this doc and to `proto/<service>.proto`.

---

## Definition of Done (gRPC RPC)

Use this before marking a task complete or before requesting merge:

- [ ] Handler matches **proto** (fields, types, semantics).
- [ ] **InvalidArgument** / **Internal** / **NotFound** used appropriately.
- [ ] DB writes match **schema** and migrations.
- [ ] **Logging** for success/failure path.
- [ ] **Test**: grpcurl snippet in README **or** automated integration test.
- [ ] **UNIMPLEMENTED** (or real impl) for other RPCs on the same service—no mystery empty handlers.

---

## Packet capture v2 + HTTP/3 (STRICT / tshark)

- **`STRICT_QUIC_VALIDATION=1`** (see `scripts/lib/packet-capture-v2.sh`) does **not** fail when tshark omits QUIC **h3** ALPN—many builds cannot decode it without TLS secrets. Proof is **QUIC in pcap + SNI / pod stray checks + `GRPC_HTTP3_HEALTH_OK`** (curl HTTP/3).
- **Optional ALPN in Wireshark:** export **`SSLKEYLOGFILE=/tmp/sslkeys.log`**, run HTTP/3 with a curl built with **OpenSSL + ngtcp2/quiche** (not SecureTransport-only), then set **`CAPTURE_V2_TLS_KEYLOG`** (or rely on **`SSLKEYLOGFILE`**) so tshark uses **`-o tls.keylog_file:...`** when checking ALPN. **`grpcurl` does not write NSS key logs.**
- **tshark field names vary by version:** if **`-e quic.tls.handshake.extensions_alpn`** errors, run **`tshark -G fields | grep -i alpn`** and prefer **`tls.handshake.extensions_alpn_str`** with **`-Y "quic && tls.handshake.extensions_alpn_str"`** (helpers in **`scripts/lib/protocol-verification.sh`**: **`count_alpn_h3_quic_packets_in_pcap`**, **`quic_alpn_strings_from_pcap`**).
- **Which curl actually does HTTP/3 on your Mac:** default `/usr/bin/curl` is often **SecureTransport** (no HTTP/3 / key log), while **`http3_curl`** in `scripts/lib/http3.sh` may use **Homebrew curl** or **Docker**. **`./scripts/verify-curl-http3.sh`** and **Runbook.md item 91**.

---

## Edge routing (Caddy → Envoy)

- gRPC to **`off-campus-housing.local:443`** is routed by **path prefix** (e.g. `/auth.`, `/listings.`, **`/booking.`** → `booking.BookingService/...`) in **`infra/k8s/base/envoy-test/envoy.yaml`** and **`infra/k8s/ingress-nginx-envoy.yaml`**.
- After changing Envoy ConfigMaps, **roll the Envoy pod(s)** so listeners pick up the new clusters/routes.
- **Smoke:** `scripts/test-booking-http2-http3.sh` calls **grpcurl** to **`${METALLB_IP}:443`** with edge CA + **service client cert** (mTLS) and `booking.BookingService/GetBooking` (dummy id → **NotFound** is OK).

---

## References

- **PR paste template (tracked):** [docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt](PR_REVIEW_GRPC_HANDLER_PASTE.example.txt) — local `PR_REVIEW_GRPC_HANDLER_PASTE.txt` is gitignored
- **Example proto:** [proto/listings.proto](../proto/listings.proto)
- **Listings service stub:** [services/listings-service/README.md](../services/listings-service/README.md)
- **Auth / patterns:** [services/auth-service/README.md](../services/auth-service/README.md) (gRPC section, if present)
- **Cluster / TLS issues:** [Runbook.md](../Runbook.md)
