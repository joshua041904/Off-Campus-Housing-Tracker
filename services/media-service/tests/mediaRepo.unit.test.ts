/**
 * Unit tests for mediaRepo with mocked pg Pool (no real Postgres).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      query = queryMock;
      connect = vi.fn(async () => ({
        query: queryMock,
        release: vi.fn(),
      }));
    },
  },
}));

describe("mediaRepo (mocked pg)", () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  it("insertPending runs INSERT", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    const { insertPending } = await import("../src/db/mediaRepo.js");
    await insertPending("id1", "u1", "key", "f.png", "image/png", 12);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO media.media_files"),
      ["id1", "u1", "key", "f.png", "image/png", 12],
    );
  });

  it("setUploaded uses pool when no client passed", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    const { setUploaded } = await import("../src/db/mediaRepo.js");
    await setUploaded("id1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE media.media_files"),
      ["id1"],
    );
  });

  it("setUploaded uses client when passed", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query: clientQuery, release: vi.fn() } as never;
    const { setUploaded } = await import("../src/db/mediaRepo.js");
    await setUploaded("id2", client);
    expect(clientQuery).toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("getById returns null when no row", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { getById } = await import("../src/db/mediaRepo.js");
    expect(await getById("missing")).toBeNull();
  });

  it("getById maps row", async () => {
    const created = new Date("2024-01-01T00:00:00Z");
    queryMock.mockResolvedValue({
      rows: [
        {
          id: "m1",
          user_id: "u1",
          object_key: "k",
          filename: "a.png",
          content_type: "image/png",
          size_bytes: "42",
          status: "uploaded",
          created_at: created,
          updated_at: created,
        },
      ],
    });
    const { getById } = await import("../src/db/mediaRepo.js");
    const row = await getById("m1");
    expect(row).toMatchObject({
      id: "m1",
      user_id: "u1",
      size_bytes: 42,
      status: "uploaded",
    });
  });

  it("checkConnection returns true on SELECT 1", async () => {
    queryMock.mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 });
    const { checkConnection } = await import("../src/db/mediaRepo.js");
    expect(await checkConnection()).toBe(true);
  });

  it("checkConnection returns false on error", async () => {
    queryMock.mockRejectedValue(new Error("econnrefused"));
    const { checkConnection } = await import("../src/db/mediaRepo.js");
    expect(await checkConnection()).toBe(false);
  });
});
