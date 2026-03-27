# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 176.42 | 45.26 | 619.44 | — | 2231.38 |
| analytics-public | 83.69 | 23.07 | 315.57 | — | 2374.31 |
| auth-health | 51.99 | 29.30 | 157.54 | — | 939.00 |
| booking-health | 55.40 | 29.23 | 152.50 | — | 727.53 |
| booking-jwt | 121.59 | 85.48 | 288.11 | — | 1062.96 |
| event-layer-adversarial | 39.52 | 16.83 | 134.08 | — | 949.49 |
| gateway-health | 11.14 | 5.21 | 31.34 | — | 554.18 |
| listings-health | 131.81 | 44.04 | 311.13 | — | 5402.34 |
| media-health | 99.36 | 72.46 | 285.49 | — | 572.68 |
| messaging | 25.08 | 15.20 | 71.54 | — | 274.09 |
| search-watchlist | 146.31 | 99.94 | 330.93 | — | 1434.77 |
| trust-public | 269.97 | 42.90 | 1739.21 | — | 2647.52 |

_max is k6’s worst sample (treat as empirical p100)._
