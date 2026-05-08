import { afterEach, describe, expect, it } from "vitest";
import { computeEffectiveOllamaTimeoutMs, getOllamaGenerateTimeoutMs } from "../src/intelligence/generationTimeouts.js";

describe("getOllamaGenerateTimeoutMs / computeEffectiveOllamaTimeoutMs", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("respects long ANALYTICS_OLLAMA_TIMEOUT_MS for normal mode (single env authority, no hidden 60s cap)", () => {
    delete process.env.ANALYTICS_QA_FAST_MODE;
    delete process.env.ANALYTICS_DEV_FAST_MODE;
    delete process.env.ANALYTICS_UI_MODE;
    delete process.env.ANALYTICS_OLLAMA_GENERATE_CAP_MS;
    process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = "300000";
    expect(getOllamaGenerateTimeoutMs()).toBe(300_000);
    expect(computeEffectiveOllamaTimeoutMs(999)).toBe(300_000);
    process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = "400000";
    expect(getOllamaGenerateTimeoutMs()).toBe(300_000); // capped by default 300k cap
  });

  it("dev fast uses ANALYTICS_DEV_FAST_OLLAMA_CAP_MS (default 120s)", () => {
    process.env.ANALYTICS_DEV_FAST_MODE = "1";
    process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = "300000";
    delete process.env.ANALYTICS_DEV_FAST_OLLAMA_CAP_MS;
    expect(getOllamaGenerateTimeoutMs()).toBe(120_000);
    process.env.ANALYTICS_DEV_FAST_OLLAMA_CAP_MS = "90000";
    expect(getOllamaGenerateTimeoutMs()).toBe(90_000);
  });

  it("UI mode keeps short budget", () => {
    delete process.env.ANALYTICS_QA_FAST_MODE;
    delete process.env.ANALYTICS_DEV_FAST_MODE;
    process.env.ANALYTICS_UI_MODE = "1";
    process.env.ANALYTICS_OLLAMA_UI_HARD_MS = "8000";
    process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = "300000";
    expect(getOllamaGenerateTimeoutMs()).toBe(8000);
  });
});
