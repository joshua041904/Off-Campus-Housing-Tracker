import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();

vi.mock("../src/db.js", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a) },
}));

describe("runHybridSearch", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_EMBEDDING_DIMS;
    poolQuery.mockReset();
  });

  it("returns [] for blank query", async () => {
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    await expect(runHybridSearch({ query: "  ", limit: 5 })).resolves.toEqual(
      [],
    );
  });

  it("returns [] when Ollama URL unset (no embedding)", async () => {
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    await expect(runHybridSearch({ query: "loft", limit: 3 })).resolves.toEqual(
      [],
    );
  });

  it("clamps limit to [1, MAX_LIMIT]", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.OLLAMA_EMBEDDING_DIMS = "4";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4] }),
    })) as unknown as typeof fetch;
    poolQuery.mockRejectedValue(
      new Error('type "vector" does not exist'),
    );
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    await expect(
      runHybridSearch({ query: "loft", limit: 999 }),
    ).resolves.toEqual([]);
    await expect(
      runHybridSearch({ query: "loft", limit: 0 }),
    ).resolves.toEqual([]);
  });

  it("embedQuery retries then succeeds on third fetch", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.ANALYTICS_OLLAMA_RETRIES = "3";
    process.env.OLLAMA_EMBEDDING_DIMS = "4";
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n += 1;
      if (n < 3) return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4] }),
      };
    }) as unknown as typeof fetch;
    poolQuery.mockRejectedValueOnce(
      new Error('type "vector" does not exist'),
    );
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    await expect(runHybridSearch({ query: "retry", limit: 2 })).resolves.toEqual(
      [],
    );
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("throws when listing_search_index exists but query fails for other reasons", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.OLLAMA_EMBEDDING_DIMS = "4";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4] }),
    })) as unknown as typeof fetch;
    poolQuery.mockRejectedValueOnce(new Error("syntax error at or near"));
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    await expect(runHybridSearch({ query: "q", limit: 2 })).rejects.toThrow(
      "syntax error",
    );
  });

  it("returns ranked rows when pool returns data", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.OLLAMA_EMBEDDING_DIMS = "4";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4] }),
    })) as unknown as typeof fetch;
    poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            listing_id: "L1",
            title: "T",
            description: "D",
            vector_score: 0.9,
            keyword_score: 0.1,
            recency_score: 0.5,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const { runHybridSearch } = await import("../src/lib/hybrid-search.js");
    const out = await runHybridSearch({ query: "near campus", limit: 5 });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.listing_id).toBe("L1");
  });
});
