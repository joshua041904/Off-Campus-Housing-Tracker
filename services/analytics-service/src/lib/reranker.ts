/**
 * Lightweight learning-to-rank style reranker: fixed weights + normalization.
 * Replace default weights with values learned from offline logs when a trainer is available.
 */
export type LtrCandidate = {
  id: string;
  response: string;
  vectorScore: number;
  keywordScore: number;
  recency: number;
};

export type LtrWeights = {
  vector: number;
  keyword: number;
  recency: number;
  length: number;
};

const DEFAULT_WEIGHTS: LtrWeights = {
  vector: 0.6,
  keyword: 0.25,
  recency: 0.1,
  length: 0.05,
};

function normalize(x: number, max = 1): number {
  if (!Number.isFinite(x) || max <= 0) return 0;
  return Math.min(x / max, 1);
}

/** Higher is better after rerank. */
export function rerankLtrCandidates(
  candidates: LtrCandidate[],
  weights: Partial<LtrWeights> = {},
): Array<LtrCandidate & { score: number }> {
  const w: LtrWeights = { ...DEFAULT_WEIGHTS, ...weights };
  return candidates
    .map((c) => {
      const lengthScore = 1 / (c.response.length + 1);
      const score =
        w.vector * normalize(c.vectorScore) +
        w.keyword * normalize(c.keywordScore) +
        w.recency * normalize(c.recency) +
        w.length * lengthScore;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickBestLtrCandidate(
  candidates: LtrCandidate[],
  weights: Partial<LtrWeights> = {},
): (LtrCandidate & { score: number }) | null {
  const ranked = rerankLtrCandidates(candidates, weights);
  return ranked[0] ?? null;
}
