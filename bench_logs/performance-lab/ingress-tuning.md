# Ingress and Concurrency Tuning

Utilization target: 0.75

| Service | Class | Safe RPS | Pool | MAX_DB_CONCURRENCY | h2 stream cap | h3 stream cap |
|---|---|---:|---:|---:|---:|---:|
| analytics | DB_POOL_LIMITED | 99.97 | 18 | 18 | 9 | 9 |
| media | FANOUT_AMPLIFIED | 159.65 | 5 | 5 | 8 | 8 |
| messaging | FANOUT_AMPLIFIED | 197.37 | 5 | 5 | 8 | 8 |

## NGINX/Caddy Guidance

- Set per-service request rate ceilings near `recommended_safe_rps`.
- For HTTP/2, tune `http2_max_concurrent_streams` toward per-service stream cap.
- For HTTP/3, tune QUIC max streams similarly; avoid oversized initial burst windows.
- Keep app-level semaphore (`MAX_DB_CONCURRENCY`) aligned with DB pool.

