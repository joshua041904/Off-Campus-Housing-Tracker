# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 34.93 | 15.28 | 89.74 | — | 639.50 |
| analytics-public | 12.77 | 7.47 | 23.77 | — | 602.14 |
| auth-health | 28.95 | 20.06 | 70.45 | — | 481.97 |
| booking-health | 11.76 | 6.84 | 27.34 | — | 520.15 |
| booking-jwt | 33.02 | 15.80 | 106.68 | — | 534.36 |
| event-layer-adversarial | 14.26 | 5.78 | 48.46 | — | 436.24 |
| gateway-health | 6.03 | 2.64 | 11.16 | — | 446.37 |
| listings-health | 11.78 | 6.51 | 22.11 | — | 702.92 |
| media-health | 11.87 | 7.02 | 29.36 | — | 522.04 |
| messaging | 21.36 | 8.43 | 37.43 | — | 3425.34 |
| search-watchlist | 24.76 | 13.34 | 85.49 | — | 451.24 |
| trust-public | 37.19 | 12.18 | 121.78 | — | 1704.75 |

_max is k6’s worst sample (treat as empirical p100)._
