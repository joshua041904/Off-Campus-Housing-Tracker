# Protocol matrix — http_req_duration (k6 gateway health)

Source directory: `/Users/tom/Off-Campus-Housing-Tracker/bench_logs/ceiling/20260326-115253/gateway/http1/vus-10-run`

Generated: 2026-03-26T16:57:58Z

| Mode | Unit | p50/med | p90 | p95 | p99 | max |
|------|------|---------|-----|-----|-----|-----|
| HTTP/2 (PROTOCOL_MODE=http2) | ms | — | — | — | — | — |
| HTTP/1.1 (GODEBUG=http2client=0 — best effort) | ms | 12.504000000000001 | 61.693500000000014 | 84.85174999999995 | — | 273.546 |
| HTTP/3 (xk6-http3: .k6-build/bin/k6-http3) | ms | — | — | — | — | — |

## Notes

- **ALPN**: stock `k6` over `https://`; Caddy typically negotiates HTTP/2.
- **http1**: Go may still speak h2 depending on k6 build; treat as comparative hint only.
- **http3**: xk6-http3 only — `./scripts/build-k6-http3.sh` (bandorko/xk6-http3); binary at `.k6-build/bin/k6-http3` or `.k6-build/k6-http3`. See `docs/XK6_HTTP3_SETUP.md`.
