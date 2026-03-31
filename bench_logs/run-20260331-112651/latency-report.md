# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 61.36 | 30.09 | 229.94 | — | 592.89 |
| analytics-public | 28.72 | 14.16 | 86.26 | — | 879.19 |
| auth-health | 43.70 | 25.37 | 123.45 | — | 1271.90 |
| booking-health | 29.45 | 13.32 | 96.24 | — | 874.56 |
| booking-jwt | 46.79 | 16.78 | 169.78 | — | 1439.18 |
| event-layer-adversarial | 13.23 | 5.56 | 36.65 | — | 541.42 |
| gateway-health | 5.62 | 3.17 | 13.85 | — | 151.87 |
| listings-health | 29.04 | 14.78 | 75.36 | — | 1046.17 |
| media-health | 29.27 | 15.20 | 102.73 | — | 435.73 |
| messaging | 18.31 | 9.43 | 61.51 | — | 812.52 |
| search-watchlist | 68.39 | 32.69 | 254.47 | — | 1233.39 |
| trust-public | 152.79 | 62.27 | 449.79 | — | 3215.79 |

_max is k6’s worst sample (treat as empirical p100)._
