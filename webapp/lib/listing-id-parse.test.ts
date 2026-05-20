import { describe, expect, it } from "vitest";
import { parseListingIdFromUserInput, resolveWatchlistListingId } from "./listing-id-parse";

describe("listing-id-parse", () => {
  const listingId = "123e4567-e89b-42d3-a456-426614174000";

  it("parses a listing URL or bare UUID", () => {
    expect(parseListingIdFromUserInput(listingId)).toBe(listingId);
    expect(parseListingIdFromUserInput(`https://off-campus-housing.test/listings/${listingId}`)).toBe(listingId);
  });

  it("resolves a watchlist target from a single title suggestion", () => {
    expect(
      resolveWatchlistListingId("Campus loft", [{ id: listingId, title: "Campus loft" }]),
    ).toBe(listingId);
  });

  it("does not guess when multiple title suggestions exist", () => {
    expect(
      resolveWatchlistListingId("Campus", [
        { id: listingId, title: "Campus loft" },
        { id: "123e4567-e89b-42d3-a456-426614174001", title: "Campus studio" },
      ]),
    ).toBeNull();
  });
});
