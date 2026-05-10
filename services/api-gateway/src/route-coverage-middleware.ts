/**
 * Optional route-hit logging for OCH Coverage Model v1 (endpoint dimension).
 * Enable with GATEWAY_ROUTE_COVERAGE_LOG=1 (or "true"). Writes JSON lines to
 * GATEWAY_ROUTE_COVERAGE_FILE (default /tmp/och-routes-hit.jsonl in the pod).
 *
 * **Traffic classification (strict mode default ON):**
 * - **Suite** — `x-suite` present (vitest, bash, k6, playwright). Logged when logging is on.
 * - **Infra** — `x-traffic-class: infra` (bootstrap edge, HAProxy, scripted probes, K8s httpGet headers).
 * - **Internal** — `x-traffic-class: internal` (in-pod loopback curls, sidecars hitting `127.0.0.1:4020`).
 * - **Kubernetes probes (legacy)** — `User-Agent` contains `kube-probe` if no header (prefer `httpHeaders`).
 * - **Browser document navigation / fetch** — HTML Accept or browser fetch headers from first-party UI.
 *
 * Strict policy (`OCH_ENFORCE_X_SUITE`) applies only to suite-labeled traffic.
 * Requests without `x-suite` are treated as user/infra/internal lanes and are never 400-blocked.
 *
 * See `docs/TRAFFIC_CLASSIFICATION_POLICY.md`.
 */
import type { Request, Response, NextFunction } from "express";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Semantic traffic lanes (header-driven + strict fallbacks). */
export enum TrafficClass {
  SUITE = "suite",
  INFRA = "infra",
  INTERNAL = "internal",
  USER = "user",
}

function gatewayPathOnly(req: Request): string {
  return (req.originalUrl || req.url || "").split("?")[0];
}

function enabled(): boolean {
  const v = process.env.GATEWAY_ROUTE_COVERAGE_LOG;
  return v === "1" || v === "true" || v === "yes";
}

function rawTrafficClassHeader(req: Request): string {
  return (req.get("x-traffic-class") || "").trim().toLowerCase();
}

/**
 * Classify request for strict enforcement and logging.
 * Suite is determined by presence of `x-suite`; infra/internal by header value.
 */
export function classifyTraffic(req: Request): TrafficClass {
  const xSuite = (req.get("x-suite") || "").trim();
  if (xSuite.length > 0) {
    return TrafficClass.SUITE;
  }
  const raw = rawTrafficClassHeader(req);
  if (raw === TrafficClass.INFRA) {
    return TrafficClass.INFRA;
  }
  if (raw === TrafficClass.INTERNAL) {
    return TrafficClass.INTERNAL;
  }
  return TrafficClass.USER;
}

export function routeCoverageMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const file =
    process.env.GATEWAY_ROUTE_COVERAGE_FILE?.trim() || "/tmp/och-routes-hit.jsonl";

  return (req: Request, res: Response, next: NextFunction) => {
    const rawSuiteHeader = (req.get("x-suite") || "").trim();
    const trafficClass = classifyTraffic(req);

    if (!enabled()) {
      return next();
    }

    const method = req.method;
    const path = gatewayPathOnly(req);

    res.on("finish", () => {
      if (trafficClass !== TrafficClass.SUITE) {
        return;
      }
      const rawSuite = rawSuiteHeader.toLowerCase();
      const suite =
        rawSuite === "vitest" || rawSuite === "bash" || rawSuite === "k6" || rawSuite === "playwright"
          ? rawSuite
          : "unknown";
      const rec = {
        ts: new Date().toISOString(),
        method,
        path,
        status: res.statusCode,
        suite,
      };
      const out = `${JSON.stringify(rec)}\n`;
      void (async () => {
        try {
          await mkdir(dirname(file), { recursive: true });
          await appendFile(file, out);
        } catch (e) {
          console.error("[route-coverage] append failed:", e);
        }
      })();
    });
    next();
  };
}
