# Performance Lab Report

Source CSV: `/Users/tom/Off-Campus-Housing-Tracker/bench_logs/ceiling/20260326-150240/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv`
Generated: 2026-03-26T19:37:55.838Z

## Service Classification

| Service | Classification | Best Protocol | Collapse (h3/h2/h1) |
|---|---|---|---|
| analytics | DB_POOL_LIMITED | http3 | 30/30/20 |
| media | FANOUT_AMPLIFIED | http2 | 15/15/15 |
| messaging | FANOUT_AMPLIFIED | http1 | 15/15/15 |

## Protocol Merit

| Service | Protocol | Throughput Merit From VUS | Latency Merit From VUS | Stability Merit | Avg Throughput Adv % | Avg p95 Improve % |
|---|---|---:|---:|---|---:|---:|
| analytics | http3 |  |  | yes | 28.92 | 39.09 |
| analytics | http2 |  |  | yes | 28.85 | 23.37 |
| analytics | http1 |  |  | no |  |  |
| media | http3 |  | 5 | no | 0.61 | 46.75 |
| media | http2 |  | 5 | no | 0.76 | 71.07 |
| media | http1 |  |  | no |  |  |
| messaging | http3 |  |  | no |  |  |
| messaging | http2 |  |  | no |  |  |
| messaging | http1 |  |  | no |  |  |

## DB-Bound Service Models

| Service | Protocol | Max RPS Pre-Collapse | Safe RPS (0.8x) | RPS@VUS20 | Headroom RPS |
|---|---|---:|---:|---:|---:|
| analytics | http3 | 95.05 | 76.04 | 92.43355883591875 | -16.39 |
| media | http2 | 14.99 | 11.99 |  |  |
| messaging | http1 | 19.98 | 15.98 |  |  |

