# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 125.31 | 54.08 | 431.87 | — | 1181.26 |
| analytics-public | 62.05 | 21.89 | 203.00 | — | 2342.29 |
| auth-health | 31.37 | 23.87 | 71.42 | — | 344.54 |
| booking-health | 41.86 | 21.89 | 140.89 | — | 677.32 |
| booking-jwt | 2107.21 | 153.05 | 11556.06 | — | 12772.41 |
| event-layer-adversarial | 21.58 | 10.40 | 67.86 | — | 545.05 |
| gateway-health | 10.77 | 5.06 | 34.17 | — | 293.44 |
| listings-health | 42.52 | 16.74 | 142.10 | — | 1625.66 |
| media-health | 21.48 | 14.43 | 58.89 | — | 288.12 |
| messaging | 19.68 | 12.64 | 48.70 | — | 355.83 |
| search-watchlist | 5687.23 | 1627.28 | 17064.94 | — | 24297.57 |
| trust-public | 36.18 | 19.52 | 104.79 | — | 912.99 |

_max is k6’s worst sample (treat as empirical p100)._
