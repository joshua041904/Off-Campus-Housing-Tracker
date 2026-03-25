# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 61.68 | 25.05 | 219.06 | — | 659.49 |
| analytics-public | 29.67 | 16.12 | 111.08 | — | 584.67 |
| auth-health | 29.59 | 21.93 | 67.11 | — | 284.85 |
| booking-health | 23.67 | 14.45 | 55.16 | — | 389.01 |
| booking-jwt | 64.81 | 49.01 | 166.60 | — | 486.31 |
| event-layer-adversarial | 18.97 | 10.60 | 60.13 | — | 332.12 |
| gateway-health | 7.36 | 4.48 | 22.28 | — | 101.41 |
| listings-health | 28.82 | 14.21 | 85.12 | — | 845.04 |
| media-health | 31.84 | 15.61 | 104.99 | — | 758.52 |
| messaging | 15.58 | 10.16 | 37.75 | — | 343.56 |
| search-watchlist | 88.65 | 69.27 | 218.85 | — | 457.96 |
| trust-public | 29.38 | 14.38 | 58.87 | — | 1265.19 |

_max is k6’s worst sample (treat as empirical p100)._
