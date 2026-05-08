let failureCount = 0;
let latencySamples: number[] = [];
let lastFailureTime = 0;

const FAILURE_THRESHOLD = 5;
const LATENCY_THRESHOLD_MS = 1000;
const RESET_TIMEOUT_MS = 30_000;

function recordLatency(ms: number) {
  latencySamples.push(ms);
  if (latencySamples.length > 20) latencySamples.shift();
}

function avgLatency(): number {
  if (!latencySamples.length) return 0;
  return latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
}

/**
 * Adaptive circuit breaker: trips on repeated failures or high rolling average latency.
 * Returns null when open (short-circuit); otherwise returns fn() result or null if fn throws.
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T | null> {
  const now = Date.now();
  const latencyTooHigh = avgLatency() > LATENCY_THRESHOLD_MS;

  if (failureCount >= FAILURE_THRESHOLD || latencyTooHigh) {
    if (now - lastFailureTime < RESET_TIMEOUT_MS) {
      return null;
    }
    failureCount = 0;
    latencySamples = [];
  }

  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    recordLatency(duration);
    failureCount = 0;
    return result;
  } catch {
    failureCount += 1;
    lastFailureTime = now;
    return null;
  }
}
