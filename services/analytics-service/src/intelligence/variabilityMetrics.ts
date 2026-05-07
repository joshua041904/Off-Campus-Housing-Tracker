/** Helpers for intelligence QA (entropy / diversity), used by tests and scripts. */

export function jaccardSimilarity(a: string, b: string): number {
  const A = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean),
  );
  const B = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean),
  );
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Higher = more variation across pairwise verdict comparisons (0–1 scale).
 * Uses 1 - average pairwise Jaccard similarity.
 */
export function computeVerdictEntropy(verdicts: string[]): number {
  if (verdicts.length < 2) return 0;
  let totalSimilarity = 0;
  let comparisons = 0;
  for (let i = 0; i < verdicts.length; i++) {
    for (let j = i + 1; j < verdicts.length; j++) {
      totalSimilarity += jaccardSimilarity(verdicts[i]!, verdicts[j]!);
      comparisons++;
    }
  }
  const avgSimilarity = comparisons ? totalSimilarity / comparisons : 1;
  return 1 - avgSimilarity;
}

export function riskFlagDiversity(outputs: { risk_flags?: unknown[] }[]): number {
  const flags = outputs.flatMap((o) =>
    Array.isArray(o.risk_flags) ? o.risk_flags.map((x) => String(x).toLowerCase()) : [],
  );
  if (!flags.length) return 0;
  const unique = new Set(flags);
  return unique.size / flags.length;
}

export function stddev(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
