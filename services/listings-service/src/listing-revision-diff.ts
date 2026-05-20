/** Keys we record in revision history (subset of listing row + PATCH body). */
const TRACKED_KEYS = [
  "title",
  "description",
  "price_cents",
  "amenities",
  "smoke_free",
  "pet_friendly",
  "furnished",
  "display_location",
  "latitude",
  "longitude",
  "effective_from",
  "effective_until",
  "residence_type",
  "size_sqft",
  "address_line1",
  "address_line2",
  "city",
  "state_or_province",
  "postal_code",
  "country",
  "neighborhood",
  "bedrooms",
  "bathrooms",
  /** fixed | obo — surfaced in public revision history */
  "pricing_mode",
  /** Listing soft-hold end (timestamptz) */
  "soft_hold_until",
] as const;

function normVal(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function computeListingRevisionChanges(
  beforeRow: Record<string, unknown>,
  afterFields: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of TRACKED_KEYS) {
    const from = beforeRow[k];
    const to = afterFields[k];
    if (normVal(from) !== normVal(to)) {
      out[k] = { from, to };
    }
  }
  return out;
}
