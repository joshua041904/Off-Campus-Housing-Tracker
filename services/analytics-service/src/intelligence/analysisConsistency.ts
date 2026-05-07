/**
 * Post-generation checks for listing analysis prose (legacy bullets or rendered v2 text).
 * Catches common failure mode: multiple incompatible "asking rent" figures in the same narrative.
 */

const DOLLAR = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;

export function parseMonthlyUsd(priceUsd: string): number {
  const n = Number(String(priceUsd || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** Dollar amounts in typical monthly rent band (USD). */
export function extractRentSizedAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text || "").matchAll(DOLLAR)) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 400 && n <= 50_000) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * True when the same short span implies more than one incompatible headline rent for THIS unit.
 * Conservative: flags two rent-sized dollars in one sentence when sentence references asking/list price.
 */
export function detectNumericContradictionInProse(text: string, listedMonthlyUsd: number): { conflict: boolean; reason?: string } {
  const t = String(text || "");
  if (!t.trim()) return { conflict: false };
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const sent of sentences) {
    const low = sent.toLowerCase();
    if (!/(asking|listed at|list price|listed for|monthly rent|rent is|lease at)/i.test(low)) continue;
    const nums = [...sent.matchAll(DOLLAR)]
      .map((m) => Number(String(m[1]).replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n >= 500 && n <= 40_000);
    if (nums.length < 2) continue;
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (hi - lo > Math.max(120, lo * 0.12)) {
      return { conflict: true, reason: "multi_rent_in_sentence" };
    }
  }
  if (Number.isFinite(listedMonthlyUsd) && listedMonthlyUsd > 0) {
    const tol = Math.max(35, listedMonthlyUsd * 0.1);
    for (const sent of sentences) {
      const low = sent.toLowerCase();
      if (!/(asking|listed for|listed at|monthly rent is)/i.test(low)) continue;
      const nums = [...sent.matchAll(DOLLAR)]
        .map((m) => Number(String(m[1]).replace(/,/g, "")))
        .filter((n) => Number.isFinite(n) && n >= 500 && n <= 40_000);
      for (const n of nums) {
        if (Math.abs(n - listedMonthlyUsd) > tol) {
          return { conflict: true, reason: "asking_mismatch_listing" };
        }
      }
    }
  }
  return { conflict: false };
}
