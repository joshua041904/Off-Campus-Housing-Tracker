/** Decode canonical user id from JWT payload without verification (UI convenience only). */
export function getSubFromJwt(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { sub?: unknown; user_id?: unknown };
    const uid =
      typeof json.user_id === "string" && json.user_id.trim()
        ? json.user_id.trim()
        : typeof json.sub === "string" && json.sub.trim()
          ? json.sub.trim()
          : null;
    if (!uid) return null;
    const u = uid.toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u) ? u : uid;
  } catch {
    return null;
  }
}

/** Auth JWT may include `username` (handle) alongside `sub`; used for username-first UI defaults. */
export function getUsernameFromJwt(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { username?: unknown };
    const un = typeof json.username === "string" ? json.username.trim() : "";
    return un.length > 0 ? un : null;
  } catch {
    return null;
  }
}
