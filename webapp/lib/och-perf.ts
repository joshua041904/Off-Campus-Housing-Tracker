/** Dev-only performance marks and structured timing logs. */

export function perfDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PERF_DEBUG === "1";
}

export function ochPerfMark(name: string): void {
  if (typeof performance === "undefined") return;
  try {
    performance.mark(name);
  } catch {
    /* ignore duplicate marks */
  }
}

export function ochPerfMeasure(name: string, startMark: string, endMark?: string): void {
  if (typeof performance === "undefined") return;
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    /* marks may be missing */
  }
  if (!perfDebugEnabled()) return;
  const entries = performance.getEntriesByName(name, "measure");
  const last = entries[entries.length - 1];
  if (last) {
    console.info("[och:perf]", name, `${Math.round(last.duration)}ms`);
  }
}

export function logPerfDebug(event: string, detail?: Record<string, unknown>): void {
  if (!perfDebugEnabled()) return;
  console.info("[och:perf]", event, detail ?? {});
}
