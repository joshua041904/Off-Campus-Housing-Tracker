const KEY = "och_token";
const EMAIL_KEY = "och_email";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(KEY, token);
}

export function getStoredEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setStoredEmail(email: string): void {
  window.localStorage.setItem(EMAIL_KEY, email);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(EMAIL_KEY);
}
