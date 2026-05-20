// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setStoredToken, clearStoredToken } from "./auth-storage";
import { readMessagesAuthFromStorage, useMessagesAuth } from "./messages-auth";

function fakeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("readMessagesAuthFromStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("loads messages after auth token becomes available after mount", async () => {
    const { result } = renderHook(() => useMessagesAuth());
    expect(result.current.token).toBeNull();
    expect(result.current.authReady).toBe(false);

    const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    setStoredToken(fakeJwt(userId));

    await waitFor(() => {
      expect(result.current.authHydrating).toBe(false);
      expect(result.current.token).toBeTruthy();
      expect(result.current.currentUserId).toBe(userId);
      expect(result.current.authReady).toBe(true);
    });
  });

  it("does not show empty state before auth is ready", () => {
    const snap = readMessagesAuthFromStorage();
    expect(snap.token).toBeNull();
    expect(snap.currentUserId).toBeNull();
    const { result } = renderHook(() => useMessagesAuth());
    expect(result.current.authReady).toBe(false);
  });

  it("clears auth on logout event", async () => {
    const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    setStoredToken(fakeJwt(userId));
    const { result } = renderHook(() => useMessagesAuth());
    await waitFor(() => expect(result.current.authReady).toBe(true));

    clearStoredToken();
    await waitFor(() => {
      expect(result.current.token).toBeNull();
      expect(result.current.authReady).toBe(false);
    });
  });
});
