import type { ListingIntelligenceOutput } from "./types.js";
import { computeCalibratedConfidence } from "./confidenceCalibration.js";
import { mergeNearDuplicates, postProcessListingIntelligence, coerceListingIntelligence } from "./postProcessor.js";

function pickLonger(a: string, b: string): string {
  return b.length > a.length ? b : a;
}

export function mergeEnsembleIntelligence(outputs: ListingIntelligenceOutput[]): ListingIntelligenceOutput {
  if (outputs.length === 0) {
    return coerceListingIntelligence({});
  }
  if (outputs.length === 1) return postProcessListingIntelligence({ ...outputs[0]! });

  let verdict = outputs[0]!.verdict.trim();
  for (let i = 1; i < outputs.length; i++) {
    const v = outputs[i]!.verdict.trim();
    if (v && !verdict.includes(v.slice(0, 40))) verdict = `${verdict} ${v}`.trim().slice(0, 900);
  }

  const merged: ListingIntelligenceOutput = {
    verdict,
    market_positioning: outputs.reduce((a, o) => pickLonger(a, o.market_positioning), outputs[0]!.market_positioning),
    value_drivers: mergeNearDuplicates(outputs.flatMap((o) => o.value_drivers)),
    pricing_signal: outputs.reduce((a, o) => pickLonger(a, o.pricing_signal), outputs[0]!.pricing_signal),
    risk_flags: mergeNearDuplicates(outputs.flatMap((o) => o.risk_flags)),
    missing_information: mergeNearDuplicates(outputs.flatMap((o) => o.missing_information)),
    negotiation_leverage: mergeNearDuplicates(outputs.flatMap((o) => o.negotiation_leverage)),
    negotiation_strategy: outputs.reduce((a, o) => pickLonger(a, o.negotiation_strategy), outputs[0]!.negotiation_strategy),
    confidence_score: computeCalibratedConfidence(outputs),
    risk_severity_index: Math.round(
      outputs.reduce((s, o) => s + o.risk_severity_index, 0) / outputs.length,
    ),
    pricing_pressure_score: Math.round(
      outputs.reduce((s, o) => s + o.pricing_pressure_score, 0) / outputs.length,
    ),
  };
  return postProcessListingIntelligence(merged);
}
