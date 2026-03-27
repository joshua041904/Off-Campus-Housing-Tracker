# Protocol ranking (tail-weighted)

Composite score weights: throughput 0.35, latency 0.20, tail risk 0.25, stability 0.20.

## analytics

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.8566 | 131.49 | 608.60 | 0.00% |
| http2 | 0.4867 | 163.21 | 654.56 | 48.53% |
| http3 | 0.7727 | 131.09 | 447.34 | 0.05% |

- **Winner (score):** http1 (composite 0.8566)
- **Model best_protocol:** http1
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 35.94
- **Max pre-collapse RPS (any protocol, collapse summary):** 131.49
- **Recommended pool (capacity file or default 10):** 62
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** -0.1968
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 20
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## auth

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.1216 | 5.43 | 2316.01 | 0.08% |
| http2 | 0.9134 | 226.39 | 174.48 | 0.00% |
| http3 | 0.8536 | 289.65 | 218.56 | 0.03% |

- **Winner (score):** http2 (composite 0.9134)
- **Model best_protocol:** http2
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 97.79
- **Max pre-collapse RPS (any protocol, collapse summary):** 289.65
- **Recommended pool (capacity file or default 10):** 78
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** 0.2794
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 36
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** true
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true

## booking

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.6762 | 110.77 | 541.46 | 0.00% |
| http2 | 0.7274 | 129.89 | 707.38 | 0.00% |
| http3 | 0.7573 | 122.54 | 481.28 | 0.00% |

- **Winner (score):** http3 (composite 0.7573)
- **Model best_protocol:** http1
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 41.30
- **Max pre-collapse RPS (any protocol, collapse summary):** 129.89
- **Recommended pool (capacity file or default 10):** 58
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** -0.0566
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 24
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## event-layer

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.215 | 1.65 | 1534.26 | 0.00% |
| http2 | 0.8348 | 113.79 | 93.69 | 0.00% |
| http3 | 0.8764 | 207.05 | 217.26 | 0.00% |

- **Winner (score):** http3 (composite 0.8764)
- **Model best_protocol:** http2
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 95.25
- **Max pre-collapse RPS (any protocol, collapse summary):** 207.05
- **Recommended pool (capacity file or default 10):** 38
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** 0.8196
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 18
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** true
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true

## gateway

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.7162 | 473.55 | 53.49 | 0.00% |
| http2 | 0.6271 | 563.60 | 138.70 | 0.00% |
| http3 | 0.6506 | 1.00 | 0.00 | 0.00% |

- **Winner (score):** http1 (composite 0.7162)
- **Model best_protocol:** http3
- **Envelope stable (utilization pool=10 < 0.85):** true
- **Predicted safe RPS @ pool=10 (winner row):** 619.12
- **Max pre-collapse RPS (any protocol, collapse summary):** 563.60
- **Recommended pool (capacity file or default 10):** 10
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** -0.9982
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** n/a
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** n/a
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## listings

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.6148 | 122.20 | 114.79 | 0.00% |
| http2 | 0.7474 | 199.11 | 562.69 | 0.00% |
| http3 | 0.6038 | 143.28 | 471.85 | 0.00% |

- **Winner (score):** http2 (composite 0.7474)
- **Model best_protocol:** http1
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 40.03
- **Max pre-collapse RPS (any protocol, collapse summary):** 198.73
- **Recommended pool (capacity file or default 10):** 41
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** -0.2804
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 23
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## media

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.4875 | 12.28 | 9693.19 | 0.00% |
| http2 | 0.998 | 14.99 | 42.48 | 0.00% |
| http3 | 0.9861 | 14.99 | 45.15 | 0.00% |

- **Winner (score):** http2 (composite 0.998)
- **Model best_protocol:** http3
- **Envelope stable (utilization pool=10 < 0.85):** true
- **Predicted safe RPS @ pool=10 (winner row):** 451.88
- **Max pre-collapse RPS (any protocol, collapse summary):** 14.99
- **Recommended pool (capacity file or default 10):** 5
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** 0
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 1
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## messaging

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.7582 | 19.98 | 36.56 | 0.00% |
| http2 | 0.7255 | 19.98 | 41.66 | 0.00% |
| http3 | 0.7191 | 19.98 | 62.12 | 0.00% |

- **Winner (score):** http1 (composite 0.7582)
- **Model best_protocol:** http1
- **Envelope stable (utilization pool=10 < 0.85):** true
- **Predicted safe RPS @ pool=10 (winner row):** 552.81
- **Max pre-collapse RPS (any protocol, collapse summary):** 19.98
- **Recommended pool (capacity file or default 10):** 5
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** 0
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 1
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** false
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true
- **Note:** HTTP/3 effective RPS ≤ HTTP/2 (τ not materially > 0); pool sizing does not unlock H3 transport superiority.

## trust

| Protocol | Composite | RPS | p95 ms | fail rate |
|----------|----------:|----:|-------:|----------:|
| http1 | 0.4091 | 62.47 | 203.47 | 68.22% |
| http2 | 0.7602 | 59.34 | 310.94 | 0.00% |
| http3 | 0.8353 | 104.59 | 914.14 | 0.00% |

- **Winner (score):** http3 (composite 0.8353)
- **Model best_protocol:** http3
- **Envelope stable (utilization pool=10 < 0.85):** false
- **Predicted safe RPS @ pool=10 (winner row):** 26.64
- **Max pre-collapse RPS (any protocol, collapse summary):** 104.59
- **Recommended pool (capacity file or default 10):** 42
- **HTTP/3 vs HTTP/2 τ (λ3/λ2 − 1):** 0.7625
- **Pool threshold (λ3/μ with HTTP/3 μ) for H3 advantage band:** 32
- **HTTP/3 transport “unlocked” (recommended pool ≥ threshold):** true
- **Rule B > λ2×T (backend capacity vs transport-scaled load):** true

