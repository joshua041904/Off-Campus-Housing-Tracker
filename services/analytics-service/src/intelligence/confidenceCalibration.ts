import { wordJaccardSimilarity } from "./postProcessor.js";
import type { ListingIntelligenceOutput } from "./types.js";

export function computeVerdictAgreement(outputs: ListingIntelligenceOutput[]): number {
  if (outputs.length < 2) return 0.72;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      sum += wordJaccardSimilarity(outputs[i]!.verdict, outputs[j]!.verdict);
      n++;
    }
  }
  return n === 0 ? 0.72 : sum / n;
}

export function riskIndexVariance(outputs: ListingIntelligenceOutput[]): number {
  const values = outputs.map((o) => o.risk_severity_index);
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

/** Map agreement + variance into 0–100 confidence (ensemble or single). */
export function computeCalibratedConfidence(outputs: ListingIntelligenceOutput[]): number {
  const agreement = computeVerdictAgreement(outputs);
  const variance = riskIndexVariance(outputs);
  const base = outputs.length >= 2 ? 0.62 : 0.7;
  const agreementBoost = agreement * 0.28;
  const variancePenalty = Math.min(variance * 0.06, 0.22);
  const raw = base + agreementBoost - variancePenalty;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

export function buildConfidenceExplanation(params: {
  outputs: ListingIntelligenceOutput[];
  calibrated: number;
  ensemble: boolean;
  latencyDegraded: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`Calibrated confidence ${params.calibrated}/100.`);
  if (!params.ensemble) {
    parts.push("Single-model path: baseline certainty without cross-model agreement.");
  } else {
    const ag = (computeVerdictAgreement(params.outputs) * 100).toFixed(0);
    const vr = riskIndexVariance(params.outputs).toFixed(2);
    parts.push(`Ensemble: verdict agreement ~${ag}% word overlap; risk-index variance ${vr}.`);
  }
  if (params.latencyDegraded) parts.push("Latency throttle reduced ensemble depth for responsiveness.");
  return parts.join(" ");
}
