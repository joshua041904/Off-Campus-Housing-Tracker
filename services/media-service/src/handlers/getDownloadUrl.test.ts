import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/mediaRepo.js", () => ({
  getById: vi.fn(),
}));

vi.mock("../storage/s3.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../storage/s3.js")>();
  return {
    ...mod,
    createPresignedGetUrl: vi.fn(),
  };
});

import { getById } from "../db/mediaRepo.js";
import { createPresignedGetUrl } from "../storage/s3.js";
import { getDownloadUrl } from "./getDownloadUrl.js";

describe("getDownloadUrl", () => {
  beforeEach(() => {
    process.env.S3_PRESIGN_ENDPOINT = "https://storage.test:9443";
  });
  afterEach(() => {
    delete process.env.S3_PRESIGN_ENDPOINT;
    vi.clearAllMocks();
  });

  it("rewrites S3 presigned GET URLs for browser-reachable host", async () => {
    vi.mocked(getById).mockResolvedValue({
      id: "m1",
      user_id: "u1",
      object_key: "users/u1/x.png",
      filename: "x.png",
      content_type: "image/png",
      size_bytes: 10,
      status: "uploaded",
      created_at: new Date(),
      updated_at: new Date(),
      inline_byte_len: 0,
    });
    vi.mocked(createPresignedGetUrl).mockResolvedValue(
      "http://minio:9000/housing-media/users%2Fu1%2Fx.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=x",
    );
    const out = await getDownloadUrl("m1");
    expect(out).not.toBeNull();
    expect(out!.downloadUrl).toMatch(/^https:\/\/storage\.test:9443\//);
    expect(out!.downloadUrl).not.toContain("minio:9000");
  });
});
