# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 72.41 | 35.94 | 286.32 | — | 599.92 |
| analytics-public | 83.36 | 30.67 | 209.46 | — | 1847.19 |
| auth-health | 65.36 | 34.08 | 215.22 | — | 1351.20 |
| booking-health | 92.22 | 39.11 | 347.11 | — | 1754.85 |
| booking-jwt | 98.63 | 67.76 | 264.91 | — | 672.36 |
| event-layer-adversarial | 39.36 | 16.75 | 162.18 | — | 1237.50 |
| gateway-health | 12.79 | 5.21 | 27.35 | — | 1147.68 |
| listings-health | 45.49 | 19.56 | 144.73 | — | 1914.20 |
| media-health | 28.47 | 14.92 | 63.77 | — | 1297.72 |
| messaging | 25.53 | 14.38 | 72.32 | — | 779.19 |
| search-watchlist | 130.14 | 94.92 | 370.98 | — | 851.43 |
| trust-public | 132.50 | 32.60 | 413.23 | — | 5202.84 |

_max is k6’s worst sample (treat as empirical p100)._
