# Ingress and Concurrency Tuning

Utilization target: 0.75

| Service | Class | Safe RPS | Pool | MAX_DB_CONCURRENCY | h2 stream cap | h3 stream cap |
|---|---|---:|---:|---:|---:|---:|
| analytics | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | 131.92 | 62 | 62 | 31 | 31 |
| auth | TRANSPORT_SENSITIVE | 291.63 | 78 | 78 | 39 | 39 |
| booking | TRANSPORT_SENSITIVE | 130.38 | 58 | 58 | 29 | 29 |
| event-layer | TRANSPORT_SENSITIVE | 212.33 | 38 | 38 | 19 | 19 |
| gateway | TRANSPORT_SENSITIVE | 450.88 | n/a | 20 | 16 | 16 |
| listings | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | 199.09 | 41 | 41 | 21 | 21 |
| media | FANOUT_AMPLIFIED | 211.82 | 5 | 5 | 8 | 8 |
| messaging | FANOUT_AMPLIFIED | 259.13 | 5 | 5 | 8 | 8 |
| trust | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | 104.88 | 42 | 42 | 21 | 21 |

## NGINX/Caddy Guidance

- Set per-service request rate ceilings near `recommended_safe_rps`.
- For HTTP/2, tune `http2_max_concurrent_streams` toward per-service stream cap.
- For HTTP/3, tune QUIC max streams similarly; avoid oversized initial burst windows.
- Keep app-level semaphore (`MAX_DB_CONCURRENCY`) aligned with DB pool.

