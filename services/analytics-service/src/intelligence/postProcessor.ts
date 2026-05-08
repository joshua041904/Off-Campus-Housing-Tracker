import type { ListingIntelligenceOutput } from "./types.js";

function dedupeArray(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function tokenizeWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard similarity on word sets (cheap semantic proxy). */
export function wordJaccardSimilarity(a: string, b: string): number {
  const aw = tokenizeWords(a);
  const bw = tokenizeWords(b);
  if (aw.size === 0 && bw.size === 0) return 1;
  if (aw.size === 0 || bw.size === 0) return 0;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  const union = aw.size + bw.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function mergeNearDuplicates(arr: string[], threshold = 0.82): string[] {
  const deduped = dedupeArray(arr);
  const result: string[] = [];
  for (const item of deduped) {
    const dup = result.some((existing) => wordJaccardSimilarity(existing, item) >= threshold);
    if (!dup) result.push(item);
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Flatten model leaves so nested objects never become "[object Object]" in bullets.
 * Supports common LLM shapes: { text }, { type, text }, { label, detail }, { title, body }.
 */
export function unknownToReadableString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(unknownToReadableString).filter(Boolean).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.type === "string" && typeof o.text === "string") {
      const t = `${String(o.type).trim()}: ${String(o.text).trim()}`.trim();
      if (t.length > 1) return t;
    }
    if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
    if (typeof o.summary === "string" && o.summary.trim()) return o.summary.trim();
    if (typeof o.title === "string" && typeof o.body === "string") {
      const t = `${String(o.title).trim()}: ${String(o.body).trim()}`.trim();
      if (t.length > 1) return t;
    }
    if (typeof o.label === "string" && typeof o.detail === "string") {
      const t = `${String(o.label).trim()} — ${String(o.detail).trim()}`.trim();
      if (t.length > 1) return t;
    }
    try {
      return JSON.stringify(o);
    } catch {
      return "";
    }
  }
  return String(v).trim();
}

function asString(v: unknown, fallback = ""): string {
  const s = unknownToReadableString(v);
  return s || fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => unknownToReadableString(x)).filter((s) => s.length > 0);
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce unknown JSON into the contract shape. */
export function coerceListingIntelligence(raw: unknown): ListingIntelligenceOutput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let value_drivers = asStringArray(o.value_drivers);
  const pricing_signal = asString(o.pricing_signal);
  if (!value_drivers.length && pricing_signal) {
    value_drivers = mergeNearDuplicates(pricing_signal.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
  }

  let negotiation_leverage = asStringArray(o.negotiation_leverage);
  const negotiation_strategy = asString(o.negotiation_strategy);
  if (!negotiation_leverage.length && negotiation_strategy) {
    negotiation_leverage = mergeNearDuplicates(
      negotiation_strategy.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean),
    );
  }

  return {
    verdict: asString(o.verdict, "Insufficient structured output."),
    market_positioning: asString(o.market_positioning),
    value_drivers,
    pricing_signal,
    risk_flags: asStringArray(o.risk_flags),
    missing_information: asStringArray(o.missing_information),
    negotiation_leverage,
    negotiation_strategy,
    confidence_score: asNumber(o.confidence_score, 55),
    risk_severity_index: asNumber(o.risk_severity_index, 5),
    pricing_pressure_score: asNumber(o.pricing_pressure_score, 5),
  };
}

export function postProcessListingIntelligence(output: ListingIntelligenceOutput): ListingIntelligenceOutput {
  output.value_drivers = mergeNearDuplicates(output.value_drivers);
  output.negotiation_leverage = mergeNearDuplicates(output.negotiation_leverage);
  output.risk_flags = mergeNearDuplicates(output.risk_flags);
  output.missing_information = mergeNearDuplicates(output.missing_information);
  output.confidence_score = clamp(Math.round(output.confidence_score), 0, 100);
  output.risk_severity_index = clamp(output.risk_severity_index, 0, 10);
  output.pricing_pressure_score = clamp(output.pricing_pressure_score, 0, 10);
  return output;
}
