import { randomUUID } from "node:crypto";

/** Deterministic-ish unique handle for new accounts (citext-safe). */
export function deriveUsernameFromEmail(email: string): string {
  const base = String(email || "")
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const stem = base || "user";
  return `${stem}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}
