/**
 * Unit tests for `src/ollama.ts` with `fetch`, DB pool, and locks mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.hoisted(() => vi.fn());
const acquireLockWithToken = vi.hoisted(() => vi.fn());
const releaseLockWithToken = vi.hoisted(() => vi.fn());

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
}));

vi.mock("@common/utils", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@common/utils")>();
  return {
    ...mod,
    acquireLockWithToken: (...args: unknown[]) => acquireLockWithToken(...args),
    releaseLockWithToken: (...args: unknown[]) => releaseLockWithToken(...args),
  };
});

describe("analytics ollama", () => {
  const origOllamaUrl = process.env.OLLAMA_BASE_URL;
  const origModel = process.env.OLLAMA_MODEL;
  const origStrict = process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA;
  const origTimeout = process.env.ANALYTICS_OLLAMA_TIMEOUT_MS;
  const origRetries = process.env.ANALYTICS_OLLAMA_RETRIES;

  beforeEach(() => {
    poolQuery.mockReset();
    acquireLockWithToken.mockReset().mockResolvedValue(true);
    releaseLockWithToken.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => '{"error":"no"}',
      } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = origOllamaUrl;
    if (origModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = origModel;
    if (origStrict === undefined) delete process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA;
    else process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA = origStrict;
    if (origTimeout === undefined) delete process.env.ANALYTICS_OLLAMA_TIMEOUT_MS;
    else process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = origTimeout;
    if (origRetries === undefined) delete process.env.ANALYTICS_OLLAMA_RETRIES;
    else process.env.ANALYTICS_OLLAMA_RETRIES = origRetries;
  });

  it("computeListingFeelQualityScore returns 0 for empty", async () => {
    const { computeListingFeelQualityScore } = await import("../src/ollama.js");
    expect(computeListingFeelQualityScore("   ")).toBe(0);
  });

  it("computeListingFeelQualityScore penalizes slop phrases", async () => {
    const { computeListingFeelQualityScore } = await import("../src/ollama.js");
    const t =
      "- a\n- b\n- c\n- d\n- e\n- f\n" +
      "Some body text that is long enough to add length score without being empty. ".repeat(4) +
      "great opportunity here";
    const s = computeListingFeelQualityScore(t);
    expect(s).toBeLessThan(0.9);
  });

  it("analyzeListingFeelText uses cache when model is LLM", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery.mockResolvedValueOnce({
      rows: [{ analysis_text: "- cached\n- line", model: "llama3.2:1b" }],
    });
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "t",
      description: "d",
      price_cents: 100_00,
      audience: "renter",
    });
    expect(out.model_used).toBe("llama3.2:1b");
    expect(out.analysis_text).toContain("cached");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("analyzeListingFeelText skips non-LLM cache model and uses Ollama path", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery
      .mockResolvedValueOnce({
        rows: [{ analysis_text: "old", model: "rule-based-fallback" }],
      })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: "- a\n- b\n- c\n- d\n- e\n- f\nplain" }),
    } as Response);
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "Title",
      description: "Desc ".repeat(30),
      price_cents: 50_00,
      audience: "renter",
    });
    expect(out.model_used).toContain("llama");
    expect(fetch).toHaveBeenCalled();
  });

  it("analyzeListingFeelText returns none when OLLAMA_BASE_URL unset", async () => {
    delete process.env.OLLAMA_BASE_URL;
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "t",
      description: "d",
      price_cents: 10_00,
      audience: "renter",
    });
    expect(out.model_used).toBe("none");
    expect(out.analysis_text).toMatch(/OLLAMA_BASE_URL/);
  });

  it("analyzeListingFeelText uses retry cache when lock not acquired", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    acquireLockWithToken.mockResolvedValueOnce(false);
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ analysis_text: "- r1\n- r2\n- r3\n- r4\n- r5\n- r6", model: "m2" }],
      });
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "Lock",
      description: "Story ".repeat(20),
      price_cents: 20_00,
      audience: "landlord",
    });
    expect(out.model_used).toBe("m2");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("analyzeListingFeelText falls back on non-OK fetch", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery.mockResolvedValue({ rows: [] });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "upstream",
    } as Response);
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "T",
      description: "D ".repeat(25),
      price_cents: 30_00,
      audience: "renter",
    });
    expect(out.model_used).toBe("rule-based-fallback");
  });

  it("analyzeListingFeelText falls back when response JSON parse yields no response", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery.mockResolvedValue({ rows: [] });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "not-json{{{",
    } as Response);
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "T2",
      description: "D2 ".repeat(25),
      price_cents: 30_00,
      audience: "renter",
    });
    expect(out.model_used).toBe("rule-based-fallback");
  });

  it("analyzeListingFeelText dedupes repeated hyphenated bullet stems", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery.mockResolvedValue({ rows: [] });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          response:
            "- Lease traps - no rent caps mentioned\n- Lease traps - no penalties described\n- Market positioning - looks fair vs comps",
        }),
    } as Response);
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "T",
      description: "D ".repeat(25),
      price_cents: 30_00,
      audience: "renter",
    });
    expect((out.analysis_text.match(/Lease traps/gi) || []).length).toBe(1);
    expect(out.analysis_text).toContain("Market positioning");
  });

  it("analyzeListingFeelText falls back when fetch throws", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    poolQuery.mockResolvedValue({ rows: [] });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    const out = await analyzeListingFeelText({
      title: "T3",
      description: "D3 ".repeat(25),
      price_cents: 30_00,
      audience: "renter",
    });
    expect(out.model_used).toBe("rule-based-fallback");
  });

  it("analyzeListingFeelText throws in strict mode when Ollama fails", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA = "1";
    poolQuery.mockResolvedValue({ rows: [] });
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "{}",
    } as Response);
    const { analyzeListingFeelText } = await import("../src/ollama.js");
    await expect(
      analyzeListingFeelText({
        title: "S",
        description: "Body ".repeat(30),
        price_cents: 40_00,
        audience: "renter",
      }),
    ).rejects.toThrow(/OLLAMA_REQUIRED/);
  });
});
