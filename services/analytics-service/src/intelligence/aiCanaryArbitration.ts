import { createHash } from "node:crypto";
import type { ListingIntelligenceOutput } from "./types.js";

export type ArbitrationCandidate = {
  model: string;
  output: ListingIntelligenceOutput;
  latencyMs: number;
  costPerReq: number;
  reliabilityScore: number; // 0..1
};

export type ArbitrationResult = {
  winner: ArbitrationCandidate;
  scored: Array<{
    model: string;
    score: number;
    qualityNorm: number;
    latencyNorm: number;
    reliabilityNorm: number;
    costNorm: number;
  }>;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function deterministicSamplePercent(key: string, percent: number): boolean {
  const p = clamp01(percent / 100);
  const hash = createHash("sha256").update(key).digest("hex");
  const v = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return v < p;
}

export function scoreArbitrationCandidates(
  candidates: ArbitrationCandidate[],
  weights: { quality: number; latency: number; reliability: number; cost: number },
): ArbitrationResult {
  const maxLatency = Math.max(1, ...candidates.map((c) => c.latencyMs));
  const maxCost = Math.max(0.000001, ...candidates.map((c) => c.costPerReq));
  const scored = candidates.map((c) => {
    const qualityNorm = clamp01(c.output.confidence_score / 100);
    const latencyNorm = clamp01(c.latencyMs / maxLatency);
    const reliabilityNorm = clamp01(c.reliabilityScore);
    const costNorm = clamp01(c.costPerReq / maxCost);
    const score =
      weights.quality * qualityNorm +
      weights.latency * (1 - latencyNorm) +
      weights.reliability * reliabilityNorm +
      weights.cost * (1 - costNorm);
    return {
      model: c.model,
      score,
      qualityNorm,
      latencyNorm,
      reliabilityNorm,
      costNorm,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const winnerModel = scored[0]?.model ?? candidates[0]!.model;
  const winner = candidates.find((c) => c.model === winnerModel) ?? candidates[0]!;
  return { winner, scored };
}
