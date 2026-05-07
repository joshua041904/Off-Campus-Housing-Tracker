import type { ListingIntelligenceOutput } from "./types.js";
import { unknownToReadableString } from "./postProcessor.js";

/** Turn structured intelligence into legacy plain-text bullets (+ scores as footer). */
export function renderListingIntelligenceToAnalysisText(
  out: ListingIntelligenceOutput,
  meta: { confidence_explanation: string; primary_mode: string; secondary_lens: string; depth: string },
): string {
  const S = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  lines.push(`- Verdict: ${S(out.verdict)}`);
  lines.push(`- Market positioning: ${S(out.market_positioning)}`);
  for (const d of out.value_drivers ?? []) lines.push(`- Value driver: ${unknownToReadableString(d)}`);
  if (S(out.pricing_signal)) {
    lines.push(`- Pricing signal: ${S(out.pricing_signal)}`);
  }
  for (const f of out.risk_flags ?? []) lines.push(`- Risk: ${unknownToReadableString(f)}`);
  for (const m of out.missing_information ?? []) lines.push(`- Missing info: ${unknownToReadableString(m)}`);
  for (const nl of out.negotiation_leverage ?? []) lines.push(`- Negotiation leverage: ${unknownToReadableString(nl)}`);
  if (S(out.negotiation_strategy)) {
    lines.push(`- Negotiation strategy: ${S(out.negotiation_strategy)}`);
  }
  lines.push(
    `- Scores: confidence ${out.confidence_score}/100 · risk severity ${out.risk_severity_index}/10 · pricing pressure ${out.pricing_pressure_score}/10`,
  );
  lines.push(
    `- Intelligence: mode ${meta.primary_mode} + lens ${meta.secondary_lens} · depth ${meta.depth} · ${meta.confidence_explanation}`,
  );
  return lines.join("\n").trim();
}
