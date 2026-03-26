# Performance Lab Report

Source CSV: `/Users/tom/Off-Campus-Housing-Tracker/bench_logs/ceiling/20260326-122845/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv`
Generated: 2026-03-26T18:42:39.538Z

## Service Classification

| Service | Classification | Best Protocol | Collapse (h3/h2/h1) |
|---|---|---|---|
| analytics | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http2 | 30/30/10 |
| auth | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http3 | none/40/60 |
| booking | TRANSPORT_SENSITIVE | http1 | 40/50/60 |
| event-layer | TRANSPORT_SENSITIVE | http2 | 40/none/60 |
| gateway | TRANSPORT_SENSITIVE | http2 | 10/none/none |
| listings | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http3 | 60/30/40 |
| media | FANOUT_AMPLIFIED | http2 | 30/30/30 |
| messaging | FANOUT_AMPLIFIED | http3 | 40/30/30 |
| trust | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http3 | 50/10/20 |

## Protocol Merit

| Service | Protocol | Throughput Merit From VUS | Latency Merit From VUS | Stability Merit | Avg Throughput Adv % | Avg p95 Improve % |
|---|---|---:|---:|---|---:|---:|
| analytics | http3 |  |  | yes |  |  |
| analytics | http2 |  |  | yes |  |  |
| analytics | http1 |  |  | no |  |  |
| auth | http3 |  |  | yes | 0.61 | 4.69 |
| auth | http2 |  |  | no | 23.95 | 9.66 |
| auth | http1 |  |  | no |  |  |
| booking | http3 |  |  | no |  |  |
| booking | http2 |  |  | no | 11.73 | 16.25 |
| booking | http1 |  |  | no |  |  |
| event-layer | http3 |  |  | no | 9.1 | 12.89 |
| event-layer | http2 |  |  | yes |  |  |
| event-layer | http1 |  |  | no |  |  |
| gateway | http3 |  |  | no |  |  |
| gateway | http2 |  |  | no | 15.72 | 16.92 |
| gateway | http1 |  |  | no |  |  |
| listings | http3 |  |  | yes | 18.72 | 28.98 |
| listings | http2 |  |  | no |  | 6.95 |
| listings | http1 |  |  | no |  |  |
| media | http3 |  |  | no | 0.1 | 38.9 |
| media | http2 |  | 10 | no | 0.05 | 46.04 |
| media | http1 |  |  | no |  |  |
| messaging | http3 |  | 10 | yes | 0.12 | 12.62 |
| messaging | http2 |  |  | no |  |  |
| messaging | http1 |  |  | no |  |  |
| trust | http3 |  |  | yes | 39.43 | 37.8 |
| trust | http2 |  |  | no |  |  |
| trust | http1 |  |  | no |  |  |

## DB-Bound Service Models

| Service | Protocol | Max RPS Pre-Collapse | Safe RPS (0.8x) | RPS@VUS20 | Headroom RPS |
|---|---|---:|---:|---:|---:|
| analytics | http2 | 109.1 | 87.28 | 109.10234963424084 | -21.82 |
| auth | http3 | 205.14 | 164.11 | 98.75970996612578 | 65.35 |
| listings | http3 | 145.23 | 116.19 | 59.12120601867687 | 57.07 |
| trust | http3 | 96.41 | 77.13 | 70.48639355518743 | 6.64 |

