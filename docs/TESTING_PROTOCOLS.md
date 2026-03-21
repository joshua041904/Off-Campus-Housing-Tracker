# Testing protocols (housing)

Edge and service tests should exercise **only**:

| Layer | Mechanism |
|-------|-----------|
| **Browser / edge HTTP** | **HTTP/2** (`curl --http2` or ALPN h2) or **HTTP/3** (`curl --http3-only` / `http3_curl`) with strict TLS (`--cacert` to dev CA). Avoid plain HTTP/1.1 to the public hostname except localhost debug. |
| **gRPC** | **grpcurl** or grpc-health-probe to **Envoy** (`:443`) or **NodePort**; use `-cacert` + client certs when mTLS is required. |
| **In-cluster** | gRPC health probes, `kubectl exec` curls — still h2/gRPC, not “cleartext HTTP/1” to production paths. |

## Scripts

- `scripts/test-packet-capture-standalone.sh` — H2/H3 + optional grpcurl (see `scripts/lib/packet-capture.sh`).
- `scripts/run-suite-with-packet-capture.sh` — wraps any suite with the same capture hooks.
- `scripts/test-listings-http2-http3.sh`, `scripts/test-microservices-http2-http3-housing.sh`, etc. — should prefer **`--http2`** / **`--http3-only`** as documented in each file header.

## Why

- Production traffic terminates on **Caddy** with **HTTP/2 and HTTP/3**; tests should match.
- **gRPC** uses HTTP/2 frames; validating **Envoy → service** requires gRPC clients, not raw `curl http/1.1`.
