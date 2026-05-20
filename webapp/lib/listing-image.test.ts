import { describe, expect, it } from "vitest";
import {
  demoListingImageForId,
  fallbackListingImageDataUri,
  isUnusableListingImageUrl,
  resolveListingCoverUrl,
} from "./listing-image";

describe("listing-image", () => {
  it("treats placehold.co and 1200x800 URLs as unusable", () => {
    expect(isUnusableListingImageUrl("https://placehold.co/1200x800")).toBe(true);
    expect(isUnusableListingImageUrl("https://cdn.example.com/photo.jpg")).toBe(false);
  });

  it("resolves demo fallback instead of unusable URLs", () => {
    const url = resolveListingCoverUrl("https://placehold.co/1200x800", "listing-abc", {
      title: "Studio",
    });
    expect(url).toMatch(/^\/demo-listings\//);
    expect(url).not.toContain("1200");
  });

  it("uses polished data URI when no listing id", () => {
    const url = resolveListingCoverUrl("", "", { title: "Cozy room" });
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(fallbackListingImageDataUri({ title: "Cozy room" }))).toContain("Photo coming soon");
  });

  it("picks stable demo image per listing id", () => {
    expect(demoListingImageForId("a")).toBe(demoListingImageForId("a"));
  });
});
