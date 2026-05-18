import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildFreshPublicMediaUrl, refreshCommunityImageUrlIfPublicInline } from "../src/lib/community-media-url.js";

describe("community-media-url", () => {
  beforeEach(() => {
    process.env.MEDIA_PUBLIC_URL_SECRET = "test-secret-for-url-signing";
  });
  afterEach(() => {
    delete process.env.MEDIA_PUBLIC_URL_SECRET;
  });

  it("buildFreshPublicMediaUrl returns signed /api/media/public path", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const u = buildFreshPublicMediaUrl(id);
    expect(u.startsWith(`/api/media/public/${id}?e=`)).toBe(true);
    expect(u).toContain("&s=");
  });

  it("refreshCommunityImageUrlIfPublicInline replaces stale query on same media id", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const stale = `/api/media/public/${id}?e=1&s=old`;
    const fresh = refreshCommunityImageUrlIfPublicInline(stale);
    expect(fresh).not.toBe(stale);
    const exp = Number(new URL(fresh, "https://off-campus-housing.test").searchParams.get("e") || 0);
    expect(exp).toBeGreaterThan(1_000_000);
    expect(fresh).toContain(`/api/media/public/${id}`);
  });

  it("leaves non-public URLs unchanged", () => {
    expect(refreshCommunityImageUrlIfPublicInline("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
  });
});
