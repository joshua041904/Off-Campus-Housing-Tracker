# Coherent analysis — how `scripts/lib` pieces chain together

**Orchestrated demo + capture:** `make demo-network` (see **`docs/MAKE_DEMO.md`**) exports **`SSLKEYLOGFILE`** / **`CAPTURE_V2_TLS_KEYLOG`**, runs **`run-preflight-scale-and-all-suites.sh`** with MetalLB-friendly defaults, then **`test-packet-capture-standalone.sh`** when **`TARGET_IP`** is set. **`make demo`** runs the full stack setup + preflight with **`K6_USE_METALLB=1`**.

## Building blocks

| Piece | Role |
|-------|------|
| **`http3.sh`** | Resolves a curl binary with HTTP/3 (`--http3-only`); used by edge tests. |
| **`packet-capture.sh`** | In-pod tcpdump on Caddy/Envoy, stop/analyze, optional tshark (`protocol-verification.sh`). |
| **`packet-capture-v2.sh`** | MetalLB-focused BPF + tshark QUIC checks (`STRICT_QUIC_VALIDATION`). |
| **`protocol-verification.sh`** | tshark summaries from copied pcaps. |
| **`grpc-http3-health.sh`** | Health matrix: Caddy H3 + gRPC via several paths. |
| **`kubectl-helper.sh`** / **`ensure-kubectl-shim.sh`** | Colima-safe kubectl. |

## Typical flows

1. **Standalone capture (no suite assertions)**  
   `test-packet-capture-standalone.sh` → loads `http3.sh` + `packet-capture.sh` → traffic → `stop_and_analyze_captures` / v2.

2. **Suite + capture**  
   `run-suite-with-packet-capture.sh ./scripts/test-listings-http2-http3.sh` → same capture start → runs suite → stop/analyze → log in `/tmp/packet-capture-suite-*.log`.

3. **Full regression**  
   `run-preflight-scale-and-all-suites.sh` (or your CI) orchestrates order; capture can be disabled with `DISABLE_PACKET_CAPTURE=1`.

## One coherent “analysis” mindset

1. Prove **TLS + SNI** (`off-campus-housing.test`) and **HTTP/2** to Caddy.  
2. Prove **HTTP/3/QUIC** to the same host (or document Colima limitations).  
3. Prove **gRPC** to Envoy or edge (grpcurl / health checks).  
4. Optionally correlate **pcaps** with **tshark** filters from `protocol-verification.sh`.

Keep **env** consistent: `HOST`, `PORT`, `TARGET_IP` (MetalLB), `CA_CERT`, `PROTO_DIR` for grpcurl.
