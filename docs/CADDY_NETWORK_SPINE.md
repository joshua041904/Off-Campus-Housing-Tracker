# Caddy network spine (production-grade)

Caddy is the edge for HTTP/3, REST, and gRPC. This doc describes the hardened config and how to verify it.

## Discipline

- **No regex for gRPC:** gRPC is matched by `Content-Type: application/grpc*` (and HTTP/2). No path-with-dot regex.
- **Explicit REST paths:** `path /api/* /auth/* /listings/* /booking/* /messaging/* /analytics/* /trust/*` plus `not header Content-Type application/grpc*`. No path_regexp.
- **SNI enforced:** Wrong or missing host → `421 Misdirected Request`. Primary vhost is `https://off-campus-housing.test` only.
- **TLS:** TLS 1.2/1.3 only; ciphers restricted to `TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA256`, `TLS_CHACHA20_POLY1305_SHA256`.
- **No silent catch-all:** Explicit `@web path /*` to api-gateway; `:443` fallback (other SNI) returns 421, no proxy.
- **Tracing:** `X-Request-Id`, `Traceparent`, `Tracestate` passed to backends (OTel-ready).
- **Data path:** Caddy → api-gateway / Envoy directly. ingress-nginx is not in the request path.

## Logging

- Global log: `format json` for observability.
- Request log: `request_access` with `format json`. Monitor `{http.request.proto}`, `{http.request.host}`, `{http.request.tls.version}` for H2 vs H3 comparison.

## Readiness: gRPC routing

After Caddy rollout, verify gRPC still routes (Content-Type matcher → Envoy):

```bash
./scripts/verify-caddy-grpc-routing.sh
```

Requires: `grpcurl`, cluster with Caddy + Envoy, `certs/dev-root.pem` or `dev-root-ca` secret. Uses `grpc.health.v1.Health/Check` via Caddy :443 with authority `off-campus-housing.test`; expects SERVING.

## Related

- `Caddyfile` — full config.
- `scripts/verify-caddy-strict-tls.sh` — TLS health.
- `docs/QUIC_INVARIANT_CHECKLIST.md` — HTTP/3 invariants (if present).
- `docs/RUN-PREFLIGHT.md` — full preflight and suites.
