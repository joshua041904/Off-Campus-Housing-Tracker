# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 77.18 | 36.31 | 262.07 | — | 866.54 |
| analytics-public | 113.86 | 54.79 | 369.09 | — | 2084.01 |
| auth-health | 43.16 | 28.70 | 106.14 | — | 673.09 |
| booking-health | 64.39 | 22.84 | 197.02 | — | 1630.83 |
| booking-jwt | 118.94 | 78.72 | 261.55 | — | 1169.90 |
| event-layer-adversarial | 43.67 | 15.37 | 154.57 | — | 1409.44 |
| gateway-health | 16.78 | 7.21 | 43.36 | — | 964.23 |
| listings-health | 55.90 | 26.54 | 173.59 | — | 1182.95 |
| media-health | 28.27 | 17.59 | 56.68 | — | 533.33 |
| messaging | 25.58 | 15.42 | 64.85 | — | 737.97 |
| search-watchlist | 165.94 | 121.13 | 412.43 | — | 1444.18 |
| trust-public | 70.83 | 26.14 | 286.29 | — | 1700.74 |

_max is k6’s worst sample (treat as empirical p100)._
