import { createHash, randomInt } from "node:crypto";
import { applyDevFastTokenCap, clampNumPredict } from "./generationLimits.js";
import type { AnalysisDepth, AnalysisMode } from "./types.js";

export const JSON_CONTRACT = `Return STRICT JSON only (no markdown fences, no prose outside the JSON object).

Hard rules:
- Every array (value_drivers, risk_flags, missing_information, negotiation_leverage) MUST be a JSON array of strings only. Never put objects inside arrays. If you would use { "type": "...", "text": "..." }, instead emit one string per item that merges type + text into readable prose.
- No HTML, no bullet characters inside strings, no template placeholders (no "_user_input", "short_flag", "TBD", bare "(USD / month)" lines, or bracket-only stubs).
- Do not invent campus averages or comps; if unknown, use the exact phrase "Insufficient data" inside a string field (never fake dollar amounts as market averages).
- All string fields must be meaningful human-readable sentences or phrases (not single tokens).

Shape (numbers are integers):
{
  "verdict": "2-3 sentence executive summary",
  "market_positioning": "one dense paragraph (required)",
  "value_drivers": ["string only", "..."],
  "pricing_signal": "optional legacy paragraph (empty string allowed when value_drivers is strong)",
  "risk_flags": ["string only", "..."],
  "missing_information": ["string only", "..."],
  "negotiation_leverage": ["string only", "..."],
  "negotiation_strategy": "optional legacy paragraph (empty string allowed)",
  "confidence_score": 0,
  "risk_severity_index": 0,
  "pricing_pressure_score": 0
}

Avoid repeating the same idea across sections. confidence_score is 0-100; risk_severity_index and pricing_pressure_score are 0-10 inclusive.
Arrays: 2-5 items each unless depth is quick (then 1-3 each). No duplicate strings in arrays.
market_positioning, value_drivers, negotiation_leverage, risk_flags, missing_information are REQUIRED (non-empty strings / string arrays).`;

/** Shorter contract for analysis_depth=quick — less prompt text, smaller target JSON, faster CPU inference. */
export const JSON_CONTRACT_QUICK = `Return STRICT JSON only (no markdown, no prose outside the JSON).

Rules: arrays are JSON string arrays only (no objects inside arrays). No HTML in strings. Unknown market facts → use "Insufficient data" in a string; never invent averages. Finish every sentence; no cut-off clauses.

Shape (integers for scores):
{"verdict":"2-3 sentences: bottom-line stance + why","market_positioning":"one paragraph: price/value vs what the listing actually shows","value_drivers":["2-4 items"],"pricing_signal":"","risk_flags":["2-4 items"],"missing_information":["2-4 items: include concrete questions to verify before signing"],"negotiation_leverage":["2-4 items"],"negotiation_strategy":"","confidence_score":0,"risk_severity_index":0,"pricing_pressure_score":0}

Renter framing: verdict must state recommend / cautious / avoid (pick one) with one clear reason. Landlord framing: verdict must address pricing posture + conversion risk in one breath.

Arrays: 2-4 strings each (quick mode still complete). confidence_score 0-100; risk_severity_index and pricing_pressure_score 0-10.`;

const JSON_CONTRACT_SLOT = "<<<OCH_JSON_CONTRACT>>>";

const landlordStrategic = `You are a senior real-estate revenue strategist.
Analyze listings like a pricing and yield advisor.

MODE (landlord / offensive framing — materially different from renter mode):
- Emphasize demand signals, strengths vs alternatives, pricing support, and revenue optimization.
- Tone: confident, direct; avoid renter-style fear framing.
- Still obey the JSON contract (string-only arrays).

Focus: competitive positioning, conversion weaknesses, pricing risk, presentation gaps, concrete improvements.
No fluff. No repeated ideas. If a point is implied once, deepen it instead of restating.
${JSON_CONTRACT_SLOT}`;

const renterDefensive = `You are a tenant risk analyst (renter advocate).

MODE (renter / defensive framing — materially different from landlord mode):
- Emphasize risks, information gaps, lease or fee traps, and negotiation leverage.
- Be conservative with confidence_score when evidence in the listing is thin.
- Tone: skeptical, practical; avoid landlord-style “easy win” hype.

Focus: hidden costs, asymmetric risk, what to verify before signing.
No repeated headings. No generic filler.
${JSON_CONTRACT_SLOT}`;

const marketQuant = `You are a quantitative housing analyst.
Use economic framing: price vs amenities, demand proxies, liquidity, comparability. Avoid emotional language.
${JSON_CONTRACT_SLOT}`;

const conversionOptimization = `You are a listing conversion strategist.
Focus: clarity, trust signals, psychological friction, missing proof, differentiation vs competitors.
${JSON_CONTRACT_SLOT}`;

const riskAudit = `You are a housing risk and compliance auditor.
Focus: legal/regulatory exposure, ambiguous lease language, financial traps, structural risks.
${JSON_CONTRACT_SLOT}`;

const MODE_SYSTEM: Record<AnalysisMode, string> = {
  landlord_strategic: landlordStrategic,
  renter_defensive: renterDefensive,
  market_quant: marketQuant,
  conversion_optimization: conversionOptimization,
  risk_audit: riskAudit,
};

const SECONDARY_LENSES: AnalysisMode[] = ["market_quant", "risk_audit", "conversion_optimization"];

export function primaryModeForAudience(audience: "landlord" | "renter"): AnalysisMode {
  return audience === "landlord" ? "landlord_strategic" : "renter_defensive";
}

/** Random per request for controlled variability (not seeded by listing body). */
export function pickSecondaryLens(audience: "landlord" | "renter"): AnalysisMode {
  const primary = primaryModeForAudience(audience);
  const pool = SECONDARY_LENSES.filter((m) => m !== primary);
  return pool[randomInt(0, pool.length)]!;
}

/** Stable lens for tests / debugging only. */
export function pickSecondaryLensDeterministic(
  title: string,
  description: string,
  audience: "landlord" | "renter",
): AnalysisMode {
  const h = createHash("sha256").update(`${title}|${description}|${audience}|lens`).digest();
  const idx = h[0]! % SECONDARY_LENSES.length;
  let lens = SECONDARY_LENSES[idx]!;
  const primary = primaryModeForAudience(audience);
  if (lens === primary) lens = SECONDARY_LENSES[(idx + 1) % SECONDARY_LENSES.length]!;
  return lens;
}

export function depthInstructions(depth: AnalysisDepth): string {
  switch (depth) {
    case "quick":
      return "Detail level: QUICK — highest-impact insights only; keep every field short; fewer array entries.";
    case "deep":
      return "Detail level: DEEP — nuanced reasoning, more specific evidence tied to the description text.";
    default:
      return "Detail level: STANDARD — balanced depth and brevity.";
  }
}

/** ANALYTICS_REASONING_MODE=shallow|balanced|deep — steers internal reconciliation without exposing chain-of-thought. */
export function reasoningModeAddendum(): string {
  const raw = String(process.env.ANALYTICS_REASONING_MODE || "balanced").toLowerCase();
  const mode = raw === "shallow" || raw === "deep" ? raw : "balanced";
  if (mode === "shallow") {
    return "Reasoning mode: SHALLOW — prioritize crisp JSON; keep arrays tight; avoid long digressions.";
  }
  if (mode === "deep") {
    return "Reasoning mode: DEEP — before writing the final JSON, internally reconcile pricing math vs the stated asking rent, and ensure negotiation bullets do not contradict pricing bullets. Do not reveal private chain-of-thought; output only the JSON contract.";
  }
  return "Reasoning mode: BALANCED — cross-check that dollar figures you cite for THIS listing match the stated asking rent unless you explicitly label a figure as comps or market average.";
}

export function maxTokensForDepth(depth: AnalysisDepth): number {
  let n: number;
  switch (depth) {
    case "quick":
      n = clampNumPredict(520);
      break;
    case "deep":
      n = clampNumPredict(700);
      break;
    default:
      n = clampNumPredict(560);
      break;
  }
  return applyDevFastTokenCap(n);
}

export function buildListingIntelligencePrompts(input: {
  audience: "landlord" | "renter";
  title: string;
  description: string;
  priceUsd: string;
  depth: AnalysisDepth;
  /** Extra structured facts (amenities, lease window, geo). Do not truncate above env-driven cap. */
  listingFacts?: Record<string, unknown>;
}): { system: string; prompt: string; primary_mode: AnalysisMode; secondary_lens: AnalysisMode } {
  const primary_mode = primaryModeForAudience(input.audience);
  const useDeterministic =
    process.env.ANALYTICS_LI_SECONDARY_LENS_DETERMINISTIC === "1" ||
    process.env.NODE_ENV === "test";
  const secondary_lens = useDeterministic
    ? pickSecondaryLensDeterministic(input.title, input.description, input.audience)
    : pickSecondaryLens(input.audience);
  const contract = input.depth === "quick" ? JSON_CONTRACT_QUICK : JSON_CONTRACT;
  const modeBody = MODE_SYSTEM[primary_mode].replace(JSON_CONTRACT_SLOT, contract);
  const lensBlock =
    input.depth === "quick"
      ? ""
      : `Secondary lens (lightly weave 1–2 cross-references, no duplicated sections): perspective of "${secondary_lens}".

`;
  const system = `${modeBody}

${lensBlock}Vary phrasing across runs; do not repeat boilerplate openers.
${depthInstructions(input.depth)}
${reasoningModeAddendum()}`;

  const facts =
    input.listingFacts && Object.keys(input.listingFacts).length > 0
      ? `\nStructured facts (ground answers in these; do not invent amenities or policies not stated):\n${JSON.stringify(input.listingFacts, null, 2)}\n`
      : "";

  const desc = String(input.description || "");

  const prompt = `Listing:
Title: ${input.title}
Full description (complete text; analyze all of it):
${desc}
Asking (USD / month): ${input.priceUsd}${facts}
Produce the JSON object now. Respond ONLY with valid JSON matching the contract.`;

  return { system, prompt, primary_mode, secondary_lens };
}
