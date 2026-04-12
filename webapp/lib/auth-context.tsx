"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clearStoredToken,
  getStoredEmail,
  getStoredToken,
  setStoredEmail,
  setStoredToken,
} from "@/lib/auth-storage";

type AuthContextValue = {
  authReady: boolean;
  token: string | null;
  email: string | null;
  isAuthenticated: boolean;
  login: (token: string, email: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = getStoredToken();
    const storedEmail = getStoredEmail();

    setToken(storedToken);
    setEmail(storedEmail);
    setAuthReady(true);
  }, []);

  const login = useCallback((nextToken: string, nextEmail: string) => {
    const normalizedEmail = nextEmail.trim();
    setStoredToken(nextToken);
    setStoredEmail(normalizedEmail);
    setToken(nextToken);
    setEmail(normalizedEmail);
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setEmail(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authReady,
      token,
      email,
      isAuthenticated: Boolean(token),
      login,
      logout,
    }),
    [authReady, token, email, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}