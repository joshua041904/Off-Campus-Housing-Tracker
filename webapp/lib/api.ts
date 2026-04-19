import { getApiBase } from "./config";

export type ApiError = { error?: string; message?: string };
export const LISTING_SEARCH_SORTS = [
  "created_desc",
  "listed_desc",
  "price_asc",
  "price_desc",
] as const;
export type ListingSearchSort = (typeof LISTING_SEARCH_SORTS)[number];

export function normalizeListingSearchSort(
  sort?: string | null,
): ListingSearchSort {
  return LISTING_SEARCH_SORTS.includes(sort as ListingSearchSort)
    ? (sort as ListingSearchSort)
    : "created_desc";
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  const base = getApiBase();
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers);
  if (
    !headers.has("Content-Type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }
  const { token, ...rest } = init;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...rest, headers });
}

export async function registerUser(email: string, password: string) {
  const res = await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const data = (await parseJson(res)) as {
    token?: string;
    user?: unknown;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `register failed: ${res.status}`);
  return data;
}

export async function loginUser(email: string, password: string) {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const data = (await parseJson(res)) as {
    token?: string;
    requiresMFA?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `login failed: ${res.status}`);
  if (data.requiresMFA)
    throw new Error(
      "MFA required — use a test account without MFA for the webapp demo.",
    );
  return data;
}

export async function postSearchHistory(
  token: string,
  body: {
    query?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    maxDistanceKm?: number;
    latitude?: number;
    longitude?: number;
  },
) {
  const res = await apiFetch("/api/booking/search-history", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok)
    throw new Error(
      (data as ApiError)?.error || `search-history ${res.status}`,
    );
  return data;
}

export async function listSearchHistory(token: string, limit = 25) {
  const res = await apiFetch(
    `/api/booking/search-history/list?limit=${limit}`,
    {
      method: "GET",
      token,
    },
  );
  const data = (await parseJson(res)) as { items?: unknown[] };
  if (!res.ok)
    throw new Error(
      (data as ApiError)?.error || `list search-history ${res.status}`,
    );
  return data.items ?? [];
}

export async function watchlistAdd(
  token: string,
  listingId: string,
  source?: string,
) {
  const res = await apiFetch("/api/booking/watchlist/add", {
    method: "POST",
    token,
    body: JSON.stringify({ listingId, source: source ?? "webapp" }),
  });
  const data = await parseJson(res);
  if (!res.ok)
    throw new Error((data as ApiError)?.error || `watchlist add ${res.status}`);
  return data;
}

export type WatchlistRemoveResult = {
  ok?: boolean;
  removed?: number;
  message?: string;
};

export async function watchlistRemove(
  token: string,
  listingId: string,
): Promise<WatchlistRemoveResult> {
  const res = await apiFetch("/api/booking/watchlist/remove", {
    method: "POST",
    token,
    body: JSON.stringify({ listingId }),
  });
  const data = await parseJson(res);
  if (!res.ok)
    throw new Error(
      (data as ApiError)?.error || `watchlist remove ${res.status}`,
    );
  return data as WatchlistRemoveResult;
}

export async function watchlistList(token: string) {
  const res = await apiFetch("/api/booking/watchlist/list", {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: unknown[] };
  if (!res.ok)
    throw new Error(
      (data as ApiError)?.error || `watchlist list ${res.status}`,
    );
  return data.items ?? [];
}

export type ListingJson = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  price_cents: number;
  amenities?: string[];
  smoke_free?: boolean | null;
  pet_friendly?: boolean | null;
  furnished?: boolean | null;
  status?: string;
  created_at?: string;
  /** ISO date (YYYY-MM-DD) from listings.listings.listed_at */
  listed_at?: string | null;
  /** When listings-service stores geo (optional). */
  latitude?: number | null;
  longitude?: number | null;
};

export type ListingsSearchParams = {
  q?: string;
  min_price?: number;
  max_price?: number;
  smoke_free?: boolean;
  pet_friendly?: boolean;
  furnished?: boolean;
  /** Comma-separated amenity slugs (e.g. garage,parking) — JSON array containment on listings.amenities */
  amenities?: string;
  new_within_days?: number;
  /** created_desc | listed_desc | price_asc | price_desc */
  sort?: ListingSearchSort | string;
};

export function buildListingsSearchParams(
  params: ListingsSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams();
  const sort = normalizeListingSearchSort(params.sort);
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.min_price != null && !Number.isNaN(params.min_price))
    sp.set("min_price", String(params.min_price));
  if (params.max_price != null && !Number.isNaN(params.max_price))
    sp.set("max_price", String(params.max_price));
  if (params.smoke_free) sp.set("smoke_free", "1");
  if (params.pet_friendly) sp.set("pet_friendly", "1");
  if (params.furnished) sp.set("furnished", "1");
  if (params.amenities?.trim()) sp.set("amenities", params.amenities.trim());
  if (params.new_within_days != null && params.new_within_days > 0) {
    sp.set("new_within_days", String(Math.floor(params.new_within_days)));
  }
  sp.set("sort", sort);
  return sp;
}

export async function searchListings(params: ListingsSearchParams) {
  const sp = buildListingsSearchParams(params);
  const q = sp.toString();
  const res = await apiFetch(`/api/listings/search${q ? `?${q}` : ""}`);
  const data = (await parseJson(res)) as {
    items?: ListingJson[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `listings search ${res.status}`);
  return data.items ?? [];
}

export async function getListing(id: string) {
  const res = await apiFetch(
    `/api/listings/listings/${encodeURIComponent(id)}`,
  );
  const data = (await parseJson(res)) as ListingJson & ApiError;
  if (!res.ok) throw new Error(data?.error || `get listing ${res.status}`);
  return data as ListingJson;
}

export async function createListing(
  token: string,
  body: {
    title: string;
    description?: string;
    price_cents: number;
    effective_from: string;
    effective_until?: string;
    amenities?: string[];
    smoke_free?: boolean;
    pet_friendly?: boolean;
    furnished?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  },
) {
  const res = await apiFetch("/api/listings/create", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as ListingJson & ApiError;
  if (!res.ok) throw new Error(data?.error || `create listing ${res.status}`);
  return data as ListingJson;
}

export async function reportAbuse(
  token: string,
  body: {
    abuse_target_type: "listing" | "user";
    target_id: string;
    category?: string;
    details?: string;
  },
) {
  const res = await apiFetch("/api/trust/report-abuse", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    data?: { flag_id?: string; status?: string };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `report abuse ${res.status}`);
  return data.data ?? null;
}

export async function submitPeerReview(
  token: string,
  body: {
    booking_id: string;
    reviewee_id: string;
    side?: string;
    rating: number;
    comment?: string;
  },
) {
  const res = await apiFetch("/api/trust/peer-review", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    data?: { review_id?: string };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `peer review ${res.status}`);
  return data.data ?? null;
}

export async function getReputation(userId: string) {
  const res = await apiFetch(
    `/api/trust/reputation/${encodeURIComponent(userId)}`,
  );
  const data = (await parseJson(res)) as {
    data?: { user_id?: string; score?: number };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `reputation ${res.status}`);
  return {
    user_id: data.data?.user_id ?? userId,
    score: data.data?.score ?? 0,
  };
}

export type DailyMetricsJson = {
  date?: string;
  new_users?: number;
  new_listings?: number;
  new_bookings?: number;
  completed_bookings?: number;
  messages_sent?: number;
  listings_flagged?: number;
};

export async function getDailyMetrics(date: string) {
  const res = await apiFetch(
    `/api/analytics/daily-metrics?date=${encodeURIComponent(date)}`,
  );
  const data = (await parseJson(res)) as DailyMetricsJson & ApiError;
  if (!res.ok) throw new Error(data?.error || `daily metrics ${res.status}`);
  return data;
}

export async function getWatchlistInsights(token: string, userId: string) {
  const res = await apiFetch(
    `/api/analytics/insights/watchlist/${encodeURIComponent(userId)}`,
    {
      method: "GET",
      token,
    },
  );
  const data = (await parseJson(res)) as {
    watchlist_adds_30d?: number;
    watchlist_removes_30d?: number;
    notes?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(data?.error || `watchlist insights ${res.status}`);
  return data;
}

export type SearchSummaryItem = {
  query?: string | null;
  min_price_cents?: number | null;
  max_price_cents?: number | null;
  max_distance_km?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string;
};

/** Past searches from analytics (read-only booking DB on cluster when POSTGRES_URL_BOOKINGS is set). Requires JWT + matching user. */
export async function getSearchSummaryInsights(token: string, userId: string) {
  const res = await apiFetch(
    `/api/analytics/insights/search-summary/${encodeURIComponent(userId)}`,
    {
      method: "GET",
      token,
    },
  );
  const data = (await parseJson(res)) as {
    user_id?: string;
    items?: SearchSummaryItem[];
    hint?: string;
    notification_hook?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `search summary ${res.status}`);
  return data;
}

export async function analyzeListingFeel(
  token: string | null,
  body: {
    title: string;
    description?: string;
    price_cents: number;
    audience?: "landlord" | "renter";
  },
) {
  const res = await apiFetch("/api/analytics/insights/listing-feel", {
    method: "POST",
    token: token ?? undefined,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    analysis_text?: string;
    model_used?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `listing feel ${res.status}`);
  return data;
}
