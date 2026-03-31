# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 81.14 | 37.13 | 164.88 | — | 2201.46 |
| analytics-public | 83.63 | 26.60 | 274.83 | — | 2013.74 |
| auth-health | 33.63 | 24.52 | 76.37 | — | 595.58 |
| booking-health | 58.11 | 25.12 | 153.28 | — | 3040.93 |
| booking-jwt | 113.32 | 69.75 | 323.80 | — | 1034.63 |
| event-layer-adversarial | 24.40 | 11.43 | 69.02 | — | 1141.14 |
| gateway-health | 7.93 | 4.84 | 16.30 | — | 472.80 |
| listings-health | 51.42 | 20.78 | 147.17 | — | 1651.79 |
| media-health | 24.56 | 17.25 | 63.58 | — | 643.50 |
| messaging | 18.15 | 13.11 | 34.57 | — | 721.82 |
| search-watchlist | 142.04 | 95.87 | 403.21 | — | 1256.28 |
| trust-public | 50.47 | 22.34 | 145.83 | — | 1124.67 |

_max is k6’s worst sample (treat as empirical p100)._
