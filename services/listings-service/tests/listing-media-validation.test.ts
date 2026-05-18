import { describe, expect, it } from "vitest";
import {
  validateListingImageUrlHead,
  validateListingImageUrlShape,
} from "../src/listing-media-validation.js";

describe("listing-media-validation", () => {
  it("accepts https CDN URLs", () => {
    expect(validateListingImageUrlShape("https://cdn.example/p.jpg").ok).toBe(true);
  });

  it("accepts OCH gateway media paths", () => {
    expect(
      validateListingImageUrlShape(
        "/api/media/public/aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee?e=1&s=sig",
      ).ok,
    ).toBe(true);
    expect(validateListingImageUrlShape("/media/public/x").ok).toBe(true);
  });

  it("rejects arbitrary relative paths", () => {
    expect(validateListingImageUrlShape("/api/other/x").ok).toBe(false);
    expect(validateListingImageUrlShape("/not-media/x").ok).toBe(false);
  });

  it("HEAD validation skips fetch for /api/media paths", async () => {
    const out = await validateListingImageUrlHead("/api/media/public/aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee");
    expect(out.ok).toBe(true);
  });
});
