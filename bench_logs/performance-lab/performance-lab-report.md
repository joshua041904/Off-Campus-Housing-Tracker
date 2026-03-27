# Performance Lab Report

Source CSV: `/Users/tom/Off-Campus-Housing-Tracker/bench_logs/ceiling/20260326-155712/combined-10/ALL_SERVICES_PROTOCOLS_VU_COMBINED.csv`
Generated: 2026-03-26T23:16:32.783Z

## Service Classification

| Service | Classification | Best Protocol | Collapse (h3/h2/h1) |
|---|---|---|---|
| analytics | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http1 | 40/40/60 |
| auth | TRANSPORT_SENSITIVE | http3 | none/40/20 |
| booking | TRANSPORT_SENSITIVE | http2 | 40/60/40 |
| event-layer | TRANSPORT_SENSITIVE | http3 | 50/20/10 |
| gateway | TRANSPORT_SENSITIVE | http2 | 10/none/50 |
| listings | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http2 | 50/50/20 |
| media | FANOUT_AMPLIFIED | http2 | 30/30/10 |
| messaging | FANOUT_AMPLIFIED | http1 | 30/30/30 |
| trust | DB_POOL_LIMITED_TRANSPORT_SENSITIVE | http3 | 50/30/10 |

## Protocol Merit

| Service | Protocol | Throughput Merit From VUS | Latency Merit From VUS | Stability Merit | Avg Throughput Adv % | Avg p95 Improve % |
|---|---|---:|---:|---|---:|---:|
| analytics | http3 | 20 | 20 | no | 18.35 | 26.96 |
| analytics | http2 |  |  | no |  | 9.81 |
| analytics | http1 |  |  | no |  |  |
| auth | http3 |  |  | yes | 1770.24 |  |
| auth | http2 |  |  | yes | 2569 | 66.72 |
| auth | http1 |  |  | no |  |  |
| booking | http3 |  |  | no | 6.61 | 17.26 |
| booking | http2 |  |  | yes | 8.31 | 11.26 |
| booking | http1 |  |  | no |  |  |
| event-layer | http3 |  |  | yes |  |  |
| event-layer | http2 |  |  | yes |  |  |
| event-layer | http1 |  |  | no |  |  |
| gateway | http3 |  |  | no |  |  |
| gateway | http2 |  |  | yes | 23.37 | 52.01 |
| gateway | http1 |  |  | no |  |  |
| listings | http3 |  |  | yes | 42.36 | 23.91 |
| listings | http2 |  |  | yes |  |  |
| listings | http1 |  |  | no |  |  |
| media | http3 |  |  | yes |  | 1.98 |
| media | http2 |  |  | yes |  |  |
| media | http1 |  |  | no |  |  |
| messaging | http3 |  |  | no |  |  |
| messaging | http2 |  |  | no | 0.08 | 44.91 |
| messaging | http1 |  |  | no |  |  |
| trust | http3 | 10 |  | yes | 39.1 | 24.07 |
| trust | http2 |  |  | yes |  |  |
| trust | http1 |  |  | no |  |  |

## DB-Bound Service Models

| Service | Protocol | Max RPS Pre-Collapse | Safe RPS (0.8x) | RPS@VUS20 | Headroom RPS |
|---|---|---:|---:|---:|---:|
| analytics | http1 | 131.49 | 105.19 | 101.75321114792246 | 3.44 |
| auth | http3 | 289.65 | 231.72 | 135.69869760885575 | 96.02 |
| booking | http2 | 129.89 | 103.91 | 106.78137188244486 | -2.87 |
| event-layer | http3 | 207.05 | 165.64 | 193.11389854074693 | -27.47 |
| gateway | http2 | 563.6 | 450.88 | 323.1813659994423 | 127.7 |
| listings | http2 | 198.73 | 158.98 | 116.46708436073291 | 42.51 |
| media | http2 | 14.99 | 11.99 | 14.988490802040632 | -3 |
| messaging | http1 | 19.98 | 15.98 | 19.980058236874747 | -4 |
| trust | http3 | 104.59 | 83.67 | 88.17452353357204 | -4.5 |

