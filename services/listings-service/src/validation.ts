/**
 * Shared validation utilities for Listings service.
 * Used by both gRPC and HTTP layers to ensure consistent behavior.
 */

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type CreateListingInput = {
  user_id?: unknown;
  title?: unknown;
  description?: unknown;
  price_cents?: unknown;
  amenities?: unknown;
  smoke_free?: unknown;
  pet_friendly?: unknown;
  furnished?: unknown;
  effective_from?: unknown;
  effective_until?: unknown;
};

export type ValidatedCreateListingInput = {
  user_id: string;
  title: string;
  description: string;
  price_cents: number;
  amenities: string[];
  smoke_free: boolean;
  pet_friendly: boolean;
  furnished: boolean | null;
  effective_from: string;
  effective_until: string;
};

export type SearchFilters = {
  min_price?: unknown;
  max_price?: unknown;
};

export type ValidatedSearchFilters = {
  min_price: number | null;
  max_price: number | null;
};

export function isValidUuid(value: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

// Trims a string and rejects empty or whitespace-only values.
export function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Checks if a string is a valid date in YYYY-MM-DD format and represents a real calendar date.
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

// Normalizes amenities input to an array of strings. Accepts arrays or objects (e.g. from form data) and converts all values to strings.
function normalizeAmenities(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

// Parses a value as a positive integer. Returns the integer or null if it's not a valid positive integer.
function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

// Parses a value as a non-negative integer. Returns the integer, null if empty, or "invalid" if it's not a valid non-negative integer.
function parseOptionalNonNegativeInteger(
  value: unknown,
): number | null | "invalid" {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return "invalid";
  return parsed;
}

export function validateListingId(value: unknown): ValidationResult<string> {
  const id = normalizeNonEmptyString(value);
  if (!id) {
    return { ok: false, message: "listing_id required" };
  }
  if (!isValidUuid(id)) {
    return { ok: false, message: "listing_id must be a valid UUID" };
  }
  return { ok: true, value: id };
}

export function validateUserId(value: unknown): ValidationResult<string> {
  const userId = normalizeNonEmptyString(value);
  if (!userId) {
    return { ok: false, message: "user_id required" };
  }
  if (!isValidUuid(userId)) {
    return { ok: false, message: "user_id must be a valid UUID" };
  }
  return { ok: true, value: userId };
}

/**
 * Validates and normalizes CreateListing input.
 * Returns clean, typed values ready for DB insertion.
 * Ensures:
 * - required fields exist and are well-formed
 * - dates are valid and logically ordered
 * - numeric values are valid
 */
export function validateCreateListingInput(
  input: CreateListingInput,
  options?: { requireUserId?: boolean },
): ValidationResult<ValidatedCreateListingInput> {
  const requireUserId = options?.requireUserId ?? true;

  let userId = "";
  if (requireUserId) {
    const userIdResult = validateUserId(input.user_id);
    if (!userIdResult.ok) {
      return userIdResult;
    }
    userId = userIdResult.value;
  } else if (input.user_id != null) {
    const maybeUserId = normalizeNonEmptyString(input.user_id);
    if (maybeUserId) {
      userId = maybeUserId;
    }
  }

  const title = normalizeNonEmptyString(input.title);
  if (!title) {
    return { ok: false, message: "title required" };
  }

  const price_cents = parsePositiveInteger(input.price_cents);
  if (price_cents == null) {
    return { ok: false, message: "price_cents must be a positive integer" };
  }

  const effective_from = normalizeNonEmptyString(input.effective_from);
  if (!effective_from) {
    return { ok: false, message: "effective_from required" };
  }
  if (!isValidDateString(effective_from)) {
    return {
      ok: false,
      message: "effective_from must be a valid YYYY-MM-DD date",
    };
  }

  const effectiveUntilRaw = normalizeNonEmptyString(input.effective_until);
  const effective_until = effectiveUntilRaw ?? "";
  if (effectiveUntilRaw && !isValidDateString(effectiveUntilRaw)) {
    return {
      ok: false,
      message: "effective_until must be a valid YYYY-MM-DD date",
    };
  }
  if (effectiveUntilRaw && effectiveUntilRaw < effective_from) {
    return {
      ok: false,
      message: "effective_until cannot be earlier than effective_from",
    };
  }

  return {
    ok: true,
    value: {
      user_id: userId,
      title,
      description:
        typeof input.description === "string" ? input.description.trim() : "",
      price_cents,
      amenities: normalizeAmenities(input.amenities),
      smoke_free: Boolean(input.smoke_free),
      pet_friendly: Boolean(input.pet_friendly),
      furnished: input.furnished != null ? Boolean(input.furnished) : null,
      effective_from,
      effective_until,
    },
  };
}

// Validates optional min/max price filters for search requests.
export function validateSearchFilters(
  input: SearchFilters,
): ValidationResult<ValidatedSearchFilters> {
  const min_price = parseOptionalNonNegativeInteger(input.min_price);
  if (min_price === "invalid") {
    return { ok: false, message: "min_price must be a non-negative integer" };
  }

  const max_price = parseOptionalNonNegativeInteger(input.max_price);
  if (max_price === "invalid") {
    return { ok: false, message: "max_price must be a non-negative integer" };
  }

  if (min_price != null && max_price != null && min_price > max_price) {
    return {
      ok: false,
      message: "min_price cannot be greater than max_price",
    };
  }

  return {
    ok: true,
    value: {
      min_price,
      max_price,
    },
  };
}
