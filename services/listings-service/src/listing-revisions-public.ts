/**
 * Public, marketplace-safe listing revision summaries (no raw owner ids, no street address).
 */

const PRIVATE_SNAPSHOT_KEYS = new Set([
  "address_line1",
  "address_line2",
  "postal_code",
  "latitude",
  "longitude",
  "user_id",
  "landlord_user_id",
  "internal_notes",
  "moderation_notes",
]);

const PRIVATE_CHANGE_KEYS = new Set([
  ...PRIVATE_SNAPSHOT_KEYS,
  "geocode_raw",
  "flag_reason",
]);

function clipStr(v: unknown, n: number): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s || s === "null") return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Strip nested objects down for public display (no raw UUIDs in arbitrary string fields). */
function scrubValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
      return "(updated)";
    }
    return s;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (o.action === "added" && typeof o.media_type === "string") {
      return { action: "added", media_type: o.media_type };
    }
    if (o.action === "removed") return { action: "removed" };
    if (o.action === "reordered") return { action: "reordered" };
    if (typeof o.action === "string") return { action: o.action };
  }
  return v;
}

/** Remove sensitive keys from a revision `changes` JSON object. */
export function sanitizePublicRevisionChanges(changes: unknown): Record<string, unknown> | null {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const o = changes as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (PRIVATE_CHANGE_KEYS.has(k)) continue;
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function publicRevisionLinesFromChanges(changes: unknown): string[] {
  if (!changes || typeof changes !== "object") return ["Listing updated"];
  const o = changes as Record<string, { from?: unknown; to?: unknown }>;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (PRIVATE_CHANGE_KEYS.has(k)) continue;
    if (k === "media_event") {
      const to = v.to as Record<string, unknown> | null | undefined;
      const from = v.from as Record<string, unknown> | null | undefined;
      if (to && typeof to === "object" && to.action === "added") {
        lines.push(`Added ${String(to.media_type || "media")}`);
      } else if (from && typeof from === "object" && from.action === "removed") {
        lines.push("Removed media");
      } else if (to && typeof to === "object" && to.action === "reordered") {
        lines.push("Reordered photos / media");
      } else {
        lines.push("Media updated");
      }
      continue;
    }
    if (k === "listing_event") {
      const flat = v as { action?: string; to?: { action?: string } };
      const action = String(flat.action ?? (typeof flat.to === "object" && flat.to ? flat.to.action : "") ?? "");
      if (action === "soft_deleted") {
        lines.push("Listing removed from marketplace");
      } else if (action) {
        lines.push(`Listing event: ${action}`);
      } else {
        lines.push("Listing lifecycle update");
      }
      continue;
    }
    const label =
      k === "price_cents"
        ? "Price (USD/mo)"
        : k === "pricing_mode"
          ? "Price mode (fixed vs best offer)"
          : k === "soft_hold_until"
            ? "Soft hold until"
            : k === "size_sqft"
              ? "Square feet"
              : k === "residence_type"
                ? "Residence type"
                : k === "display_location"
                  ? "Display location"
                  : k.replace(/_/g, " ");
    if (k === "price_cents") {
      const pf = Number(v.from);
      const pt = Number(v.to);
      const fromUsd = Number.isFinite(pf) ? (pf / 100).toFixed(0) : "—";
      const toUsd = Number.isFinite(pt) ? (pt / 100).toFixed(0) : "—";
      lines.push(`${label}: ${fromUsd} → ${toUsd}`);
    } else if (k === "pricing_mode") {
      lines.push(`${label}: ${clipStr(scrubValue(v.from), 24)} → ${clipStr(scrubValue(v.to), 24)}`);
    } else if (k === "soft_hold_until") {
      lines.push(`${label}: ${clipStr(scrubValue(v.from), 40)} → ${clipStr(scrubValue(v.to), 40)}`);
    } else if (k === "description") {
      lines.push("Description updated");
    } else {
      lines.push(`${label}: ${clipStr(scrubValue(v.from), 40)} → ${clipStr(scrubValue(v.to), 40)}`);
    }
  }
  return lines.length ? lines.slice(0, 24) : ["Listing updated"];
}
