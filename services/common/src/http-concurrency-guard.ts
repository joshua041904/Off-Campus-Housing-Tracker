import type { NextFunction, Request, Response } from "express";

export type CreateHttpConcurrencyGuardOptions = {
  /** e.g. LISTINGS_HTTP_MAX_CONCURRENT */
  envVar: string;
  /** When env unset or invalid (Little’s-law / protocol-matrix derived defaults per service). */
  defaultMax: number;
  /** Log prefix */
  serviceLabel: string;
};

/** Dev / Playwright: double the numeric default when per-service *HTTP_MAX_CONCURRENT is unset. Explicit env always wins. */
function defaultMaxWithE2eBoost(base: number): number {
  const on =
    process.env.E2E_HIGH_CAP_MODE === "1" ||
    process.env.E2E_HIGH_CAP_MODE === "true" ||
    process.env.PLAYWRIGHT_CONCURRENCY_BOOST === "1" ||
    process.env.PLAYWRIGHT_CONCURRENCY_BOOST === "true";
  if (!on) return base;
  return Math.max(1, Math.floor(base * 2));
}

function percentile95(samples: number[]): number | null {
  if (samples.length < 8) return null;
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * 0.95));
  return s[idx] ?? null;
}

/**
 * Hard cap on concurrent HTTP requests. When saturated → 503 + Retry-After (no unbounded accept queue).
 *
 * Set **HTTP_CONCURRENCY_VEGAS=1** for Vegas-style adaptation: every 5s, if observed p95 latency
 * exceeds baseline × 2, reduce effective cap by 10%; if p95 is below baseline × 1.2,
 * increase by 5% up to the env ceiling. Prevents Little’s-law + GC positive-feedback collapse under burst.
 *
 * **E2E_HIGH_CAP_MODE=1** (or **PLAYWRIGHT_CONCURRENCY_BOOST=1**): doubles **opts.defaultMax** before reading
 * **opts.envVar**, so synthetic parallel suites (e.g. 6 Playwright workers) shed less often. Production omits this.
 *
 * Mount after GET /healthz, /health, /metrics so probes stay cheap.
 */
export function createHttpConcurrencyGuard(
  opts: CreateHttpConcurrencyGuardOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const boostedDefault = defaultMaxWithE2eBoost(opts.defaultMax);
  const ceiling = Math.max(
    1,
    Number.parseInt(process.env[opts.envVar] ?? String(boostedDefault), 10) || boostedDefault,
  );
  let effectiveMax = ceiling;
  const vegas = process.env.HTTP_CONCURRENCY_VEGAS === "1" || process.env.HTTP_CONCURRENCY_VEGAS === "true";
  const baselineMs = Math.max(
    5,
    Number.parseFloat(process.env.HTTP_CONCURRENCY_VEGAS_BASELINE_MS ?? "48") || 48,
  );
  const minFloor = Math.max(1, Number.parseInt(process.env.HTTP_CONCURRENCY_VEGAS_MIN ?? "10", 10) || 10);
  const adjustMs = Math.max(
    1000,
    Number.parseInt(process.env.HTTP_CONCURRENCY_VEGAS_INTERVAL_MS ?? "5000", 10) || 5000,
  );

  const samples: number[] = [];
  const maxSamples = 256;
  let active = 0;

  if (vegas) {
    const tick = (): void => {
      const p95 = percentile95(samples);
      if (p95 == null) return;
      if (p95 > baselineMs * 2) {
        effectiveMax = Math.max(minFloor, Math.floor(effectiveMax * 0.9));
      } else if (p95 < baselineMs * 1.2) {
        effectiveMax = Math.min(ceiling, Math.floor(effectiveMax * 1.05));
      }
    };
    const id = setInterval(tick, adjustMs);
    id.unref?.();
  }

  return function httpConcurrencyGuard(req: Request, res: Response, next: NextFunction): void {
    if (active >= effectiveMax) {
      res
        .status(503)
        .setHeader("Retry-After", "1")
        .json({ error: "server_busy", message: "Over capacity" });
      return;
    }

    active++;
    const t0 = Date.now();
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      active--;
      if (vegas) {
        const ms = Date.now() - t0;
        samples.push(ms);
        if (samples.length > maxSamples) samples.shift();
      }
    };
    res.once("finish", release);
    res.once("close", release);

    try {
      next();
    } catch (err) {
      release();
      throw err;
    }
  };
}
