const WINDOW = 32;
const samples: number[] = [];

export function recordListingFeelLatencyMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  samples.push(ms);
  if (samples.length > WINDOW) samples.splice(0, samples.length - WINDOW);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** High recent latency → skip ensemble for responsiveness. */
export function latencyDegradesEnsemble(): boolean {
  const thr = Number(process.env.ANALYTICS_LATENCY_ENSEMBLE_CUTOFF_MS || "45000");
  if (!Number.isFinite(thr) || thr <= 0) return false;
  if (samples.length < 4) return false;
  return median(samples) > thr;
}
