import { describe, expect, it, vi } from "vitest";
import { onBadgesRefreshForInbox } from "./messages-inbox-events";

describe("messages inbox events", () => {
  it("reloads booking updates on och:badges-refresh", () => {
    const reload = vi.fn();
    onBadgesRefreshForInbox(
      { authReady: true, token: "tok", currentUserId: "user-a" },
      reload,
    );
    expect(reload).toHaveBeenCalledWith("badges-refresh");
  });

  it("ignores badges refresh when auth is not ready", () => {
    const reload = vi.fn();
    onBadgesRefreshForInbox({ authReady: false, token: null, currentUserId: null }, reload);
    expect(reload).not.toHaveBeenCalled();
  });
});
