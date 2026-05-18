const UUID36 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accept bare listing UUID or common listing URLs (path contains /listings/<uuid>).
 */
export function parseListingIdFromUserInput(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (UUID36.test(s)) return s.toLowerCase();
  const pathMatch = s.match(/\/listings\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|\?|#|$)/i);
  if (pathMatch?.[1]) return pathMatch[1].toLowerCase();
  try {
    const u = s.includes("://") ? new URL(s) : new URL(s, "https://placeholder.local");
    const m = u.pathname.match(/\/listings\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
    if (m?.[1]) return m[1].toLowerCase();
  } catch {
    /* ignore */
  }
  return null;
}

export function resolveWatchlistListingId(
  rawInput: string,
  suggestions: Array<{ id: string; title: string }>,
): string | null {
  const direct = parseListingIdFromUserInput(rawInput);
  if (direct) return direct;
  const input = String(rawInput || "").trim().toLowerCase();
  if (!input) return null;
  const exact = suggestions.find((item) => String(item.title || "").trim().toLowerCase() === input);
  if (exact?.id) return exact.id.toLowerCase();
  if (suggestions.length === 1 && suggestions[0]?.id) {
    return String(suggestions[0].id).toLowerCase();
  }
  return null;
}
