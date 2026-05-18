"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { getStoredToken } from "./auth-storage";
import { getSubFromJwt } from "./jwt-sub";

export type OchSessionSnapshot = {
  token: string | null;
  currentUserId: string | null;
};

export function readOchSessionFromStorage(): OchSessionSnapshot {
  if (typeof window === "undefined") {
    return { token: null, currentUserId: null };
  }
  const token = getStoredToken();
  const currentUserId = token ? getSubFromJwt(token)?.trim().toLowerCase() || null : null;
  return { token, currentUserId };
}

export type UseOchSessionResult = OchSessionSnapshot & {
  /** True until first layout-effect read of localStorage completes. */
  authHydrating: boolean;
  /** Alias for authHydrating (dashboard loading model). */
  authLoading: boolean;
  authReady: boolean;
  syncFromStorage: () => void;
};

/**
 * Hydrates JWT from localStorage before paint and on auth/storage/focus events.
 */
export function useOchSession(): UseOchSessionResult {
  const [authHydrating, setAuthHydrating] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const syncFromStorage = useCallback(() => {
    const snap = readOchSessionFromStorage();
    setToken(snap.token);
    setCurrentUserId(snap.currentUserId);
    setAuthHydrating(false);
  }, []);

  useLayoutEffect(() => {
    syncFromStorage();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "och_token" || e.key === "och_email") {
        syncFromStorage();
      }
    };
    const onAuthChanged = () => syncFromStorage();
    window.addEventListener("storage", onStorage);
    window.addEventListener("och:auth-changed", onAuthChanged);
    window.addEventListener("focus", onAuthChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("och:auth-changed", onAuthChanged);
      window.removeEventListener("focus", onAuthChanged);
    };
  }, [syncFromStorage]);

  const authReady = useMemo(
    () => !authHydrating && Boolean(token && currentUserId),
    [authHydrating, token, currentUserId],
  );

  return {
    token,
    currentUserId,
    authHydrating,
    authLoading: authHydrating,
    authReady,
    syncFromStorage,
  };
}
