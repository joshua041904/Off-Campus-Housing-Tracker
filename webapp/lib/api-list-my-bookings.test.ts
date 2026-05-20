import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { listMyBookings } from "./api";

vi.mock("./config", () => ({
  getApiBase: () => "http://test.local",
}));

describe("listMyBookings query params", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ bookings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests view=dashboard and limit for dashboard recent bookings", async () => {
    await listMyBookings("token", { role: "tenant", view: "dashboard", limit: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/booking/bookings/mine?role=tenant&view=dashboard&limit=3",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requests view=all and include_hidden when showing archived", async () => {
    await listMyBookings("token", { role: "tenant", view: "all", includeArchived: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/booking/bookings/mine?include_archived=1&include_hidden=1&role=tenant&view=all",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
