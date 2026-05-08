import { describe, expect, it } from "vitest";
import { AIFailure, AI_FAILURE_TIMEOUT } from "../src/aiFailure.js";
import { classifyListingFeelHttpFailure } from "../src/listingFeelFailure.js";

describe("classifyListingFeelHttpFailure", () => {
  it("classifies AbortError / timeout", () => {
    const e = new Error("The operation was aborted");
    e.name = "AbortError";
    expect(classifyListingFeelHttpFailure(e).code).toBe("AI_TIMEOUT");
  });

  it("preserves AIFailure codes", () => {
    const e = new AIFailure(AI_FAILURE_TIMEOUT, "Ollama timed out", { duration_ms: 100 });
    expect(classifyListingFeelHttpFailure(e).code).toBe("AI_TIMEOUT");
  });

  it("classifies connection-ish messages", () => {
    expect(classifyListingFeelHttpFailure(new Error("fetch failed: ECONNREFUSED")).code).toBe("AI_CONNECTION");
  });

  it("classifies listing-feel upstream config errors", () => {
    expect(classifyListingFeelHttpFailure(new Error("[listing-feel] OLLAMA_REQUIRED {}")).code).toBe(
      "AI_UPSTREAM_CONFIG",
    );
  });

  it("classifies chaos throws", () => {
    expect(classifyListingFeelHttpFailure(new Error("AI_CHAOS_MODE=throw@x")).code).toBe("AI_CHAOS");
  });

  it("defaults unknown to AI_FATAL", () => {
    expect(classifyListingFeelHttpFailure(new Error("something else")).code).toBe("AI_FATAL");
  });
});
