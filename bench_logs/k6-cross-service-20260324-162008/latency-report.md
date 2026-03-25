# k6 latency rollup (all services)

| run | avg (ms) | med | p(95) | p(99) | max (p100) |
|-----|----------|-----|-------|-------|------------|
| analytics-listing-feel | 26.24 | 17.40 | 57.37 | — | 389.51 |
| analytics-public | 34.09 | 18.20 | 94.59 | — | 1086.96 |
| auth-health | 26.30 | 21.25 | 52.63 | — | 245.39 |
| booking-health | 24.15 | 14.84 | 52.49 | — | 1201.23 |
| event-layer-adversarial | 11.31 | 7.90 | 22.29 | — | 435.34 |
| gateway-health | 6.55 | 4.15 | 15.38 | — | 288.32 |
| listings-health | 45.15 | 14.69 | 127.63 | — | 2224.69 |
| media-health | 12.86 | 11.11 | 22.16 | — | 71.88 |
| messaging | 11.61 | 9.26 | 19.89 | — | 152.29 |
| trust-public | 24.91 | 16.20 | 61.97 | — | 618.02 |

_max is k6’s worst sample (treat as empirical p100)._
