import { describe, expect, it } from "vitest";
import { pickBestLtrCandidate, rerankLtrCandidates } from "../src/lib/reranker.js";

describe("rerankLtrCandidates", () => {
  it("orders by combined score (vector-heavy)", () => {
    const out = rerankLtrCandidates([
      { id: "a", response: "short", vectorScore: 0.2, keywordScore: 1, recency: 1 },
      { id: "b", response: "also", vectorScore: 0.9, keywordScore: 0, recency: 0.5 },
    ]);
    expect(out[0]!.id).toBe("b");
    expect(out[1]!.id).toBe("a");
  });

  it("pickBest returns top candidate", () => {
    const best = pickBestLtrCandidate([
      { id: "x", response: "one", vectorScore: 0.1, keywordScore: 0.1, recency: 0.1 },
      { id: "y", response: "two", vectorScore: 0.95, keywordScore: 0.2, recency: 0.9 },
    ]);
    expect(best?.id).toBe("y");
    expect(best?.score).toBeGreaterThan(0);
  });
});
