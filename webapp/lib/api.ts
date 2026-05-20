import { getApiBase } from "./config";

export type ApiError = { error?: string; message?: string };

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
  const bearer = token == null ? "" : String(token).trim();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  // fetch() defaults to GET; analytics listing-feel and other JSON writes must never ship as GET.
  const method =
    rest.method ??
    (rest.body !== undefined && rest.body !== null ? "POST" : undefined);
  return fetch(url, { ...rest, ...(method ? { method } : {}), headers });
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
    /** Max distance from campus in miles (saved search + optional alerts). */
    maxCampusMiles?: number;
    latitude?: number;
    longitude?: number;
    filters?: Record<string, unknown>;
    /** When true, new listings that match this saved search can trigger notifications. */
    alertOnMatch?: boolean;
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
): Promise<{ listing_id?: string; watch_count?: number } & Record<string, unknown>> {
  const res = await apiFetch("/api/booking/watchlist/add", {
    method: "POST",
    token,
    body: JSON.stringify({ listingId, source: source ?? "webapp" }),
  });
  const data = await parseJson(res);
  if (!res.ok)
    throw new Error((data as ApiError)?.error || `watchlist add ${res.status}`);
  return data as { listing_id?: string; watch_count?: number } & Record<string, unknown>;
}

export type WatchlistRemoveResult = {
  ok?: boolean;
  removed?: number;
  message?: string;
  listing_id?: string;
  watch_count?: number;
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
  landlord_display?: string | null;
  watch_count?: number;
  title: string;
  description?: string | null;
  price_cents: number;
  /** Some endpoints also return normalized USD price fields. */
  price?: number;
  price_usd_monthly?: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  residence_type?: string | null;
  square_feet?: number | null;
  /** Legacy / DB field name from listings-service search rows. */
  size_sqft?: number | null;
  city?: string | null;
  state_or_province?: string | null;
  country?: string | null;
  neighborhood?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  distance_miles_to_campus?: number | null;
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
  /** Human-readable city/neighborhood line (never raw coordinates). */
  display_location?: string | null;
  location?: string | null;
  images?: string[];
  /** Ordered gallery rows (landlord manage + detail); includes id for reorder/delete. */
  media_items?: Array<{
    id: string;
    url_or_path: string;
    media_type: string;
    sort_order: number;
  }>;
  primaryImageUrl?: string | null;
  lease_terms?: {
    effective_from?: string | null;
    effective_until?: string | null;
    lease_length_months?: number | null;
  };
  availability_status?: string;
  /** fixed | obo (best offer) — requires listings DB migration 19. */
  pricing_mode?: "fixed" | "obo" | string;
  soft_hold_until?: string | null;
  listing_on_hold?: boolean;
  /** Filled client-side from trust `/reputation/:userId` when available. */
  host_avg_rating?: number | null;
  host_review_count?: number;
};

export type NotificationItem = {
  id: string;
  /** Recipient (same as auth user for list responses; used for legacy collapse keys). */
  user_id?: string | null;
  event_type: string;
  channel: string;
  status: string;
  payload?: {
    bookingId?: string;
    listingId?: string;
    renterId?: string;
    createdAt?: string;
    source?: string;
    type?: string;
    post_id?: string;
    post_title?: string;
    comment_id?: string;
    parent_comment_id?: string | null;
    actor_id?: string;
    actor_username?: string | null;
    actor_display_name?: string | null;
    snippet?: string | null;
    deep_link?: string | null;
    [key: string]: unknown;
  } | string | null;
  created_at: string;
  read_at?: string | null;
  dedupe_key?: string | null;
};

export async function searchListings(params: {
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
  sort?: string;
  bedrooms?: number;
  bathrooms?: number;
  available_from?: string;
  limit?: number;
  offset?: number;
}) {
  const page = await searchListingsPage(params);
  return page.data;
}

export type ListingsSearchResponse = {
  data: ListingJson[];
  nextCursor?: string | null;
  totalApprox?: number;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

export async function searchListingsPage(params: {
  q?: string;
  query?: string;
  min_price?: number;
  max_price?: number;
  minPrice?: number;
  maxPrice?: number;
  smoke_free?: boolean;
  pet_friendly?: boolean;
  furnished?: boolean;
  amenities?: string;
  new_within_days?: number;
  sort?: string;
  bedrooms?: number;
  bathrooms?: number;
  available_from?: string;
  availableFrom?: string;
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  cursor?: string;
  campusLat?: number;
  campusLng?: number;
  search_lat?: number;
  search_lng?: number;
  radius_miles?: number;
  min_lease_months?: number;
  occupancy_start?: string;
  occupancy_end?: string;
  residence_type?: string;
  residence_types?: string;
  min_sqft?: number;
  max_sqft?: number;
  city?: string;
  state?: string;
  neighborhood?: string;
  campus_within_miles?: number;
}): Promise<ListingsSearchResponse> {
  const sp = new URLSearchParams();
  if (params.q || params.query) sp.set("q", String(params.q || params.query || ""));
  const minPrice = params.min_price ?? params.minPrice;
  const maxPrice = params.max_price ?? params.maxPrice;
  if (minPrice != null && !Number.isNaN(minPrice)) sp.set("minPrice", String(minPrice));
  if (maxPrice != null && !Number.isNaN(maxPrice)) sp.set("maxPrice", String(maxPrice));
  if (params.smoke_free) sp.set("smoke_free", "1");
  if (params.pet_friendly) sp.set("pet_friendly", "1");
  if (params.furnished) sp.set("furnished", "1");
  if (params.amenities?.trim()) sp.set("amenities", params.amenities.trim());
  if (params.new_within_days != null && params.new_within_days > 0) {
    sp.set("new_within_days", String(Math.floor(params.new_within_days)));
  }
  if (params.sort?.trim()) sp.set("sort", params.sort.trim());
  if (params.bedrooms != null && Number.isFinite(params.bedrooms) && params.bedrooms > 0) {
    sp.set("bedrooms", String(Math.floor(params.bedrooms)));
  }
  if (params.bathrooms != null && Number.isFinite(params.bathrooms) && params.bathrooms > 0) {
    sp.set("bathrooms", String(Math.floor(params.bathrooms)));
  }
  const availableFrom = params.available_from ?? params.availableFrom;
  if (availableFrom?.trim()) sp.set("availableFrom", availableFrom.trim());
  if (params.limit != null && Number.isFinite(params.limit) && params.limit > 0) {
    sp.set("limit", String(Math.floor(params.limit)));
  }
  if (params.page != null && Number.isFinite(params.page) && params.page > 0) {
    sp.set("page", String(Math.floor(params.page)));
  }
  if (params.pageSize != null && Number.isFinite(params.pageSize) && params.pageSize > 0) {
    sp.set("pageSize", String(Math.floor(params.pageSize)));
  }
  if (params.offset != null && Number.isFinite(params.offset) && params.offset >= 0) {
    sp.set("offset", String(Math.floor(params.offset)));
  }
  if (params.cursor?.trim()) sp.set("cursor", params.cursor.trim());
  if (params.campusLat != null && Number.isFinite(params.campusLat)) sp.set("campusLat", String(params.campusLat));
  if (params.campusLng != null && Number.isFinite(params.campusLng)) sp.set("campusLng", String(params.campusLng));
  if (params.search_lat != null && Number.isFinite(params.search_lat)) sp.set("search_lat", String(params.search_lat));
  if (params.search_lng != null && Number.isFinite(params.search_lng)) sp.set("search_lng", String(params.search_lng));
  if (params.radius_miles != null && Number.isFinite(params.radius_miles) && params.radius_miles > 0) {
    sp.set("radius_miles", String(Math.min(200, params.radius_miles)));
  }
  if (params.min_lease_months != null && Number.isFinite(params.min_lease_months) && params.min_lease_months > 0) {
    sp.set("min_lease_months", String(Math.floor(params.min_lease_months)));
  }
  if (params.occupancy_start?.trim()) sp.set("available_start", params.occupancy_start.trim());
  if (params.occupancy_end?.trim()) sp.set("available_end", params.occupancy_end.trim());
  if (params.residence_types?.trim()) sp.set("residence_types", params.residence_types.trim());
  else if (params.residence_type?.trim()) sp.set("residence_type", params.residence_type.trim());
  if (params.min_sqft != null && Number.isFinite(params.min_sqft) && params.min_sqft > 0) {
    sp.set("min_sqft", String(Math.floor(params.min_sqft)));
  }
  if (params.max_sqft != null && Number.isFinite(params.max_sqft) && params.max_sqft > 0) {
    sp.set("max_sqft", String(Math.floor(params.max_sqft)));
  }
  if (params.city?.trim()) sp.set("city", params.city.trim());
  if (params.state?.trim()) sp.set("state", params.state.trim());
  if (params.neighborhood?.trim()) sp.set("neighborhood", params.neighborhood.trim());
  if (
    params.campus_within_miles != null &&
    Number.isFinite(params.campus_within_miles) &&
    params.campus_within_miles > 0
  ) {
    sp.set("campus_within_miles", String(Math.min(50, params.campus_within_miles)));
  }
  const q = sp.toString();
  const res = await apiFetch(`/api/listings/search${q ? `?${q}` : ""}`);
  const data = (await parseJson(res)) as {
    items?: ListingJson[];
    data?: ListingJson[];
    listings?: ListingJson[];
    nextCursor?: string | null;
    totalApprox?: number;
    totalCount?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `listings search ${res.status}`);
  return {
    data: data.data ?? data.items ?? data.listings ?? [],
    nextCursor: data.nextCursor ?? null,
    totalApprox: data.totalApprox ?? undefined,
    totalCount: data.totalCount,
    page: data.page,
    pageSize: data.pageSize,
    totalPages: data.totalPages,
  };
}

export async function getListingAvailability(
  listingId: string,
  params?: { startDate?: string; endDate?: string },
): Promise<{
  available: boolean;
  conflicts: number;
  ranges: Array<{ startDate: string; endDate: string; status: string }>;
}> {
  const sp = new URLSearchParams();
  if (params?.startDate?.trim()) sp.set("startDate", params.startDate.trim());
  if (params?.endDate?.trim()) sp.set("endDate", params.endDate.trim());
  const res = await apiFetch(
    `/api/bookings/listings/${encodeURIComponent(listingId)}/availability${sp.toString() ? `?${sp}` : ""}`,
    { method: "GET" },
  );
  const data = (await parseJson(res)) as {
    available?: boolean;
    conflicts?: number;
    ranges?: Array<{ startDate: string; endDate: string; status: string }>;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `availability ${res.status}`);
  return {
    available: Boolean(data.available),
    conflicts: Number(data.conflicts || 0),
    ranges: Array.isArray(data.ranges) ? data.ranges : [],
  };
}

export type CommunityPostSummary = {
  id: string;
  title: string;
  body?: string;
  flair?: string;
  images?: Array<{ url: string; alt?: string | null }>;
  commentCount: number;
  voteCount: number;
  /** Present when the browser sent a Bearer (gateway forwards x-user-id). */
  yourVote?: number | null;
  author_display_name?: string | null;
  author_username?: string | null;
};

export async function fetchCommunityPostsPage(params: {
  page?: number;
  pageSize?: number;
  q?: string;
  flair?: string;
  token?: string | null;
}): Promise<{
  posts: CommunityPostSummary[];
  totalCount: number;
  page: number;
  totalPages: number;
}> {
  const page = params.page != null && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = params.pageSize != null && params.pageSize > 0 ? Math.floor(params.pageSize) : 24;
  const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const q = String(params.q ?? "").trim();
  if (q) sp.set("q", q);
  const flair = String(params.flair ?? "").trim().toLowerCase();
  if (flair) sp.set("flair", flair);
  const tok = params.token != null ? String(params.token).trim() : "";
  const res = await apiFetch(`/api/community/posts?${sp.toString()}`, {
    ...(tok ? { token: tok } : {}),
  });
  const data = (await parseJson(res)) as {
    posts?: CommunityPostSummary[];
    totalCount?: number;
    page?: number;
    totalPages?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `community posts ${res.status}`);
  const rawPosts = Array.isArray(data.posts) ? data.posts : [];
  const posts = rawPosts.map((p) => {
    const yv = (p as CommunityPostSummary).yourVote;
    const yourVote = yv === 1 || yv === -1 ? yv : null;
    return { ...p, yourVote };
  });
  return {
    posts,
    totalCount: Number(data.totalCount || 0),
    page: Number(data.page || page),
    totalPages: Number(data.totalPages || 0),
  };
}

export async function fetchCommunityPost(
  postId: string,
  token?: string | null,
): Promise<{
  id: string;
  author_id: string;
  author_display_name: string | null;
  author_username: string | null;
  title: string;
  body: string;
  flair: string;
  images: Array<{ url: string; alt?: string | null }>;
  commentCount: number;
  voteCount: number;
  yourVote: number | null;
  created_at: string;
}> {
  const trimmed = token != null ? String(token).trim() : "";
  const res = await apiFetch(`/api/community/posts/${encodeURIComponent(postId)}`, {
    ...(trimmed ? { token: trimmed } : {}),
  });
  const data = (await parseJson(res)) as {
    id?: string;
    author_id?: string;
    author_display_name?: string | null;
    author_username?: string | null;
    title?: string;
    body?: string;
    flair?: string;
    images?: Array<{ url?: string; alt?: string | null }>;
    commentCount?: number;
    voteCount?: number;
    yourVote?: number | null;
    created_at?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `community post ${res.status}`);
  const yv = data.yourVote;
  const yourVote = yv === 1 || yv === -1 ? yv : null;
  return {
    id: String(data.id),
    author_id: String(data.author_id || ""),
    author_display_name: data.author_display_name ?? null,
    author_username: data.author_username ?? null,
    title: String(data.title || ""),
    body: String(data.body || ""),
    flair: String(data.flair || "general"),
    images: Array.isArray(data.images)
      ? data.images.map((it) => ({ url: String(it?.url || ""), alt: it?.alt ?? null })).filter((it) => it.url)
      : [],
    commentCount: Number(data.commentCount ?? 0),
    voteCount: Number(data.voteCount ?? 0),
    yourVote,
    created_at: String(data.created_at || ""),
  };
}

export type CommunityComment = {
  id: string;
  author_id: string;
  author_display_name?: string | null;
  author_username?: string | null;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  voteCount?: number;
  yourVote?: number | null;
};

export async function fetchCommunityComments(
  postId: string,
  token?: string | null,
): Promise<{ comments: CommunityComment[] }> {
  const trimmed = token != null ? String(token).trim() : "";
  const res = await apiFetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, {
    ...(trimmed ? { token: trimmed } : {}),
  });
  const data = (await parseJson(res)) as { comments?: CommunityComment[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `community comments ${res.status}`);
  const raw = Array.isArray(data.comments) ? data.comments : [];
  const comments = raw.map((c) => {
    const yv = (c as CommunityComment).yourVote;
    const yourVote = yv === 1 || yv === -1 ? yv : null;
    return {
      ...c,
      voteCount: Number((c as CommunityComment).voteCount ?? 0),
      yourVote,
    };
  });
  return { comments };
}

export async function voteCommunityPost(
  token: string,
  postId: string,
  value: -1 | 0 | 1,
): Promise<{ voteCount: number; yourVote: number | null }> {
  const res = await apiFetch(`/api/community/posts/${encodeURIComponent(postId)}/vote`, {
    method: "POST",
    token,
    body: JSON.stringify({ value }),
  });
  const data = (await parseJson(res)) as {
    voteCount?: number;
    yourVote?: number | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `post vote ${res.status}`);
  const yv = data.yourVote;
  const yourVote = yv === 1 || yv === -1 ? yv : null;
  return {
    voteCount: Number(data.voteCount ?? 0),
    yourVote,
  };
}

export async function voteCommunityComment(
  token: string,
  postId: string,
  commentId: string,
  value: -1 | 0 | 1,
): Promise<{ voteCount: number; yourVote: number | null }> {
  const res = await apiFetch(
    `/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/vote`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ value }),
    },
  );
  const data = (await parseJson(res)) as {
    voteCount?: number;
    yourVote?: number | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `comment vote ${res.status}`);
  const yv = data.yourVote;
  const yourVote = yv === 1 || yv === -1 ? yv : null;
  return {
    voteCount: Number(data.voteCount ?? 0),
    yourVote,
  };
}

export async function createCommunityPost(
  token: string,
  body: { title: string; body: string; flair?: string; images?: Array<{ url: string; alt?: string | null }> },
): Promise<{ id: string; title: string; body: string; flair: string; images: Array<{ url: string; alt?: string | null }>; author_id: string; created_at: string }> {
  const res = await apiFetch("/api/community/posts", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    id?: string;
    title?: string;
    body?: string;
    flair?: string;
    images?: Array<{ url?: string; alt?: string | null }>;
    author_id?: string;
    created_at?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `create community post ${res.status}`);
  return {
    id: String(data.id),
    title: String(data.title || ""),
    body: String(data.body || ""),
    flair: String(data.flair || "general"),
    images: Array.isArray(data.images)
      ? data.images.map((it) => ({ url: String(it?.url || ""), alt: it?.alt ?? null })).filter((it) => it.url)
      : [],
    author_id: String(data.author_id || ""),
    created_at: String(data.created_at || ""),
  };
}

export async function postCommunityComment(
  token: string,
  postId: string,
  body: string,
  parentCommentId?: string | null,
): Promise<unknown> {
  const payload: { body: string; parent_comment_id?: string } = { body };
  const p = parentCommentId != null ? String(parentCommentId).trim() : "";
  if (p) payload.parent_comment_id = p;
  const res = await apiFetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `comment ${res.status}`);
  return data;
}

export async function deleteCommunityPost(token: string, postId: string): Promise<void> {
  const res = await apiFetch(`/api/community/posts/${encodeURIComponent(postId)}`, {
    method: "DELETE",
    token,
  });
  if (res.status === 204) return;
  const data = (await parseJson(res)) as { error?: string };
  if (!res.ok) throw new Error(data?.error || `delete community post ${res.status}`);
}

export async function deleteCommunityComment(
  token: string,
  postId: string,
  commentId: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE",
      token,
    },
  );
  if (res.status === 204) return;
  const data = (await parseJson(res)) as { error?: string };
  if (!res.ok) throw new Error(data?.error || `delete community comment ${res.status}`);
}

export type CommunityReportRow = {
  id: string;
  reporter_id: string;
  listing_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  listing_title?: string | null;
};

export async function listCommunityReports(token: string): Promise<{ reports: CommunityReportRow[] }> {
  const res = await apiFetch("/api/community/reports", { method: "GET", token });
  const data = (await parseJson(res)) as { reports?: CommunityReportRow[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `community reports ${res.status}`);
  return { reports: Array.isArray(data.reports) ? data.reports : [] };
}

export async function patchCommunityReport(
  token: string,
  reportId: string,
  status: "resolved" | "dismissed",
): Promise<{ id: string; status: string }> {
  const res = await apiFetch(`/api/community/reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ status }),
  });
  const data = (await parseJson(res)) as { id?: string; status?: string; error?: string };
  if (!res.ok) throw new Error(data?.error || `report patch ${res.status}`);
  return { id: String(data.id), status: String(data.status) };
}

export async function getListing(id: string, opts?: { token?: string | null }) {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(id)}`, {
    token: opts?.token ?? undefined,
  });
  const data = (await parseJson(res)) as ListingJson & {
    landlord_id?: string;
    landlord_display?: string | null;
  } & ApiError;
  if (!res.ok) throw new Error(data?.error || `get listing ${res.status}`);
  const landlordId = String(data.landlord_id || data.user_id || "");
  return {
    ...data,
    user_id: String(data.user_id || landlordId),
    landlord_display: data.landlord_display ?? null,
  } as ListingJson;
}

export async function getListingMeta(id: string): Promise<{ listingId: string; activeBookingCount: number }> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(id)}/meta`);
  const data = (await parseJson(res)) as { listingId?: string; activeBookingCount?: number; error?: string };
  if (!res.ok) throw new Error(data?.error || `get listing meta ${res.status}`);
  return {
    listingId: String(data.listingId || id),
    activeBookingCount: Number(data.activeBookingCount || 0),
  };
}

export type PublicListingRevisionRow = {
  id: string;
  created_at: string;
  editor_display: string;
  lines: string[];
};

/** Public marketplace-safe revision timeline (no raw editor UUID in JSON). Optional token forwards x-user-id for draft visibility. */
export async function listPublicListingRevisions(
  listingId: string,
  opts?: { token?: string | null },
): Promise<{ revision_count: number; items: PublicListingRevisionRow[] }> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}/revisions/public`, {
    token: opts?.token ?? undefined,
  });
  const data = (await parseJson(res)) as {
    revision_count?: number;
    items?: PublicListingRevisionRow[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `public revisions ${res.status}`);
  return {
    revision_count: Math.max(0, Math.floor(Number(data.revision_count ?? 0))),
    items: Array.isArray(data.items) ? data.items : [],
  };
}

export async function requestBooking(
  token: string,
  body: {
    listing_id: string;
    renter_id: string;
    requested_date: string;
    message?: string;
  },
) {
  const res = await apiFetch("/api/booking/request", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { error?: string; booking_id?: string };
  if (!res.ok) throw new Error(data?.error || `booking request ${res.status}`);
  return data;
}

export async function createBookingDateRange(
  token: string,
  body: {
    listingId: string;
    startDate: string;
    endDate: string;
    landlordId?: string;
    priceCents?: number;
  },
) {
  const res = await apiFetch("/api/booking/create", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { error?: string; bookingId?: string; id?: string };
  if (!res.ok) throw new Error(data?.error || `booking create ${res.status}`);
  return data;
}

export async function getNotificationUnreadCount(
  token: string,
  opts?: { scope?: "user" | "landlord" | "all" },
): Promise<number> {
  const scope = opts?.scope ?? "user";
  const res = await apiFetch(`/api/notification/notifications/unread-count?scope=${encodeURIComponent(scope)}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { unreadCount?: number; error?: string };
  if (!res.ok) throw new Error(data?.error || `notification unread count ${res.status}`);
  return Number(data.unreadCount || 0);
}

export async function listNotifications(
  token: string,
  limit = 25,
  opts?: {
    eventTypes?: string[];
    audience?: "landlord" | "user" | "both";
    category?: "booking";
    scope?: "user" | "landlord" | "all";
  },
): Promise<NotificationItem[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const qs = new URLSearchParams();
  qs.set("limit", String(safeLimit));
  if (opts?.eventTypes?.length) qs.set("event_types", opts.eventTypes.join(","));
  if (opts?.audience) qs.set("audience", opts.audience);
  if (opts?.category) qs.set("category", opts.category);
  if (opts?.scope) qs.set("scope", opts.scope);
  const res = await apiFetch(`/api/notification/notifications?${qs.toString()}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: NotificationItem[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `notification list ${res.status}`);
  return data.items || [];
}

export async function markNotificationRead(
  token: string,
  notificationId: string,
): Promise<{ ok: true; notification_id?: string; read_at?: string | null; affected_rows?: number; updated?: number }> {
  const res = await apiFetch(`/api/notification/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
    token,
  });
  const data = (await parseJson(res)) as {
    error?: string;
    ok?: boolean;
    notification_id?: string;
    read_at?: string | null;
    affected_rows?: number;
    updated?: number;
  };
  if (!res.ok) throw new Error(data?.error || `mark notification read ${res.status}`);
  return {
    ok: true,
    notification_id: data?.notification_id ? String(data.notification_id) : undefined,
    read_at: data?.read_at ?? null,
    affected_rows: Number.isFinite(Number(data?.affected_rows)) ? Number(data?.affected_rows) : undefined,
    updated: Number.isFinite(Number(data?.updated)) ? Number(data?.updated) : undefined,
  };
}

export async function markNotificationsBulkRead(token: string, notificationIds: string[]): Promise<number> {
  const trimmed = notificationIds.map((x) => String(x || "").trim()).filter(Boolean);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of trimmed) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 100) break;
  }
  if (!ids.length) return 0;
  const res = await apiFetch("/api/notification/notifications/mark-read", {
    method: "POST",
    token,
    body: JSON.stringify({ notification_ids: ids }),
  });
  const data = (await parseJson(res)) as { error?: string; updated?: number };
  if (!res.ok) throw new Error(data?.error || `mark notifications read ${res.status}`);
  return Number(data.updated ?? 0);
}

export type MarkBookingContextReadResponse = {
  ok: boolean;
  booking_id: string;
  read_at: string | null;
  affected_rows: number;
  notification_ids: string[];
  updated: number;
};

export async function markBookingNotificationContextReadApi(
  token: string,
  input: { bookingId: string; notificationId?: string | null },
): Promise<MarkBookingContextReadResponse> {
  const bookingId = String(input.bookingId || "").trim().toLowerCase();
  if (!bookingId) {
    return {
      ok: true,
      booking_id: "",
      read_at: null,
      affected_rows: 0,
      notification_ids: [],
      updated: 0,
    };
  }
  const res = await apiFetch("/api/notification/notifications/mark-context-read", {
    method: "POST",
    token,
    body: JSON.stringify({
      context_type: "booking",
      booking_id: bookingId,
      bookingId,
      notification_id: input.notificationId ? String(input.notificationId).trim() : undefined,
      notificationId: input.notificationId ? String(input.notificationId).trim() : undefined,
    }),
  });
  const data = (await parseJson(res)) as {
    error?: string;
    booking_id?: string;
    read_at?: string | null;
    affected_rows?: number;
    notification_ids?: string[];
    updated?: number;
  };
  if (!res.ok) throw new Error(data?.error || `mark notifications for booking ${res.status}`);
  const notificationIds = Array.isArray(data.notification_ids)
    ? data.notification_ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    ok: true,
    booking_id: String(data.booking_id || bookingId).toLowerCase(),
    read_at: data.read_at ?? null,
    affected_rows: Number(data.affected_rows ?? data.updated ?? notificationIds.length ?? 0),
    notification_ids: notificationIds,
    updated: Number(data.updated ?? 0),
  };
}

export async function markNotificationsForBooking(token: string, bookingId: string): Promise<number> {
  const result = await markBookingNotificationContextReadApi(token, { bookingId });
  return result.updated;
}

/** Total DM + group + booking-thread unread (matches thread list semantics). */
export async function getMessagingUnreadTotal(token: string): Promise<number> {
  const res = await apiFetch("/api/messaging/messages/unread-count", { method: "GET", token });
  const data = (await parseJson(res)) as { unread_count?: number; error?: string };
  if (!res.ok) throw new Error(data?.error || `messaging unread ${res.status}`);
  return Number(data.unread_count ?? 0);
}

export async function markMessagingThreadRead(token: string, threadId: string): Promise<{ updated: number }> {
  const res = await apiFetch(
    `/api/messaging/messages/thread/${encodeURIComponent(threadId)}/mark-read`,
    { method: "POST", token },
  );
  const data = (await parseJson(res)) as { updated?: number; error?: string };
  if (!res.ok) throw new Error(data?.error || `mark thread read ${res.status}`);
  return { updated: Number(data.updated ?? 0) };
}

export async function tenantArchiveBooking(
  token: string,
  bookingId: string,
): Promise<BookingDetailPayload> {
  const res = await apiFetch(
    `/api/booking/bookings/${encodeURIComponent(bookingId)}/tenant-archive`,
    { method: "POST", token },
  );
  const data = (await parseJson(res)) as BookingDetailPayload & { error?: string };
  if (!res.ok) throw new Error(data?.error || `tenant archive ${res.status}`);
  return data as BookingDetailPayload;
}

export async function tenantUnarchiveBooking(
  token: string,
  bookingId: string,
): Promise<BookingDetailPayload> {
  const res = await apiFetch(
    `/api/booking/bookings/${encodeURIComponent(bookingId)}/tenant-unarchive`,
    { method: "POST", token },
  );
  const data = (await parseJson(res)) as BookingDetailPayload & { error?: string };
  if (!res.ok) throw new Error(data?.error || `tenant unarchive ${res.status}`);
  return data as BookingDetailPayload;
}

export async function transitionBookingStatus(
  token: string,
  bookingId: string,
  to: "ACCEPTED" | "REJECTED" | "CANCELLED" | "CONFIRMED",
): Promise<{ status: string; from?: string; to?: string }> {
  const res = await apiFetch(`/api/booking/bookings/${encodeURIComponent(bookingId)}/status`, {
    method: "POST",
    token,
    body: JSON.stringify({ to }),
  });
  const data = (await parseJson(res)) as {
    status?: string;
    from?: string;
    to?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    const msg =
      (typeof data?.message === "string" && data.message.trim()) ||
      (typeof data?.error === "string" && data.error.trim()) ||
      `booking transition ${res.status}`;
    throw new Error(msg);
  }
  return { status: String(data.status || to), from: data.from, to: data.to };
}

/** Tenant cancel via booking-service `/cancel` (same rules as status → CANCELLED). */
export async function cancelBookingAsTenant(token: string, bookingId: string): Promise<unknown> {
  const res = await apiFetch("/api/booking/cancel", {
    method: "POST",
    token,
    body: JSON.stringify({ bookingId, cancelledBy: "tenant" }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `booking cancel ${res.status}`);
  return data;
}

export type BookingDetailPayload = {
  booking_id: string;
  id?: string;
  status: string;
  tenant_id?: string;
  tenantId?: string;
  landlord_id?: string;
  landlordId?: string;
  startDate: string;
  endDate: string;
  duration_days: number;
  expires_at?: string;
  listing_title?: string | null;
  listing?: BookingListingCard | null;
  fraud_flagged?: boolean;
  tenant_email?: string | null;
  /** Sanitized handle from booking email snapshot (booking-service). */
  renter_display?: string | null;
  renter_username?: string | null;
  renter_display_name?: string | null;
  /** Host display from listing enrichment (booking-service). */
  landlord_display?: string | null;
  tenant_archived_at?: string | null;
};

export async function getBookingForUser(token: string, bookingId: string): Promise<BookingDetailPayload> {
  const res = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as BookingDetailPayload & { error?: string };
  if (!res.ok) throw new Error(data?.error || `booking ${res.status}`);
  return data as BookingDetailPayload;
}

export type BookingListingCard = {
  id: string;
  title: string;
  price_usd_monthly: number | null;
  location: string | null;
  primary_image_url: string | null;
  /** Host display from listings internal (when enrichment succeeded). */
  landlord_display?: string | null;
};

export type FraudCaseRow = {
  booking_id: string;
  listing_id: string;
  tenant_id: string;
  landlord_id: string;
  fraud_score: number;
  fraud_flagged: boolean;
  signals: string[];
  tenant_email?: string;
  /** Non-UUID label for dashboards (e.g. email local-part). */
  tenant_display?: string;
  listing_title?: string;
  listing?: BookingListingCard;
  created_at: string;
};

export type PendingBookingRow = {
  booking_id: string;
  listing_id: string;
  tenant_id: string;
  fraud_score: number;
  fraud_flagged: boolean;
  signals: string[];
  listing_title: string;
  listing?: BookingListingCard;
  tenant_email: string;
  /** Sanitized handle from snapshot email (not a verified username). */
  renter_handle?: string;
  created_at: string;
  startDate?: string;
  endDate?: string;
  duration_days?: number;
  expires_at?: string;
  status?: string;
};

export type TenantBookingSummary = {
  booking_id: string;
  /** Same as booking_id when present (booking-service public JSON). */
  id?: string;
  tenant_id?: string;
  landlord_id?: string;
  status: string;
  startDate: string;
  endDate: string;
  duration_days: number;
  expires_at: string;
  listing_id: string;
  listing_title?: string | null;
  listing?: BookingListingCard;
  fraud_flagged?: boolean;
  /** Host display label when listing enrichment succeeded. */
  landlord_display?: string | null;
  /** Host email from trust resolve (tenant-facing counterparty). */
  landlord_email?: string | null;
  /** Renter handle from email snapshot (for landlord-facing rows). */
  renter_display?: string | null;
  /** Trust/auth username when resolved (booking-service enrichment). */
  renter_username?: string | null;
  /** Trust/auth display name when resolved (booking-service enrichment). */
  renter_display_name?: string | null;
  /** Renter email snapshot at booking time (booking-service). */
  tenant_email?: string | null;
  tenant_archived_at?: string | null;
};

export type BookingMineView = "active" | "past" | "all" | "dashboard";

export async function listMyBookings(
  token: string,
  opts?: {
    includeArchived?: boolean;
    peerReviewEligible?: boolean;
    role?: "tenant" | "landlord" | "either";
    view?: BookingMineView;
    limit?: number;
  },
): Promise<TenantBookingSummary[]> {
  const params = new URLSearchParams();
  if (opts?.includeArchived) {
    params.set("include_archived", "1");
    params.set("include_hidden", "1");
  }
  if (opts?.peerReviewEligible) params.set("peer_review_eligible", "1");
  if (opts?.role) params.set("role", opts.role);
  if (opts?.view) params.set("view", opts.view);
  if (opts?.limit != null && opts.limit > 0) params.set("limit", String(Math.floor(opts.limit)));
  const qs = params.toString() ? `?${params.toString()}` : "";
  let res = await apiFetch(`/api/booking/bookings/mine${qs}`, {
    method: "GET",
    token,
  });
  if (res.status === 404) {
    res = await apiFetch(`/api/booking/mine${qs}`, {
      method: "GET",
      token,
    });
  }
  const data = (await parseJson(res)) as { bookings?: TenantBookingSummary[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `my bookings ${res.status}`);
  return data.bookings ?? [];
}

export type MessagingThreadSummary = {
  id: string;
  kind?: "dm" | "group";
  /** BookingNotice-only threads (not mixed into main DM inbox on the server). */
  threadRole?: "direct" | "booking_update";
  /** When set, inbox row navigates here (notification-backed booking updates). */
  bookingHref?: string;
  /** @deprecated use participantDisplay — kept for older clients */
  listingTitle: string;
  participantDisplay?: string;
  participantDisplayName?: string | null;
  participantUsername?: string | null;
  listingId?: string | null;
  listingContextTitle?: string | null;
  lastMessagePreview: string;
  unreadCount?: number;
  lastAt?: string;
};

export type MessagingThreadsPayload = {
  threads: MessagingThreadSummary[];
  bookingUpdates: MessagingThreadSummary[];
};

export type MessagingUserSearchResult = {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

export async function listMessagingThreads(token: string): Promise<MessagingThreadsPayload> {
  let res = await apiFetch("/api/messaging/threads", {
    method: "GET",
    token,
  });
  if (res.status === 404 || res.status === 500) {
    console.warn(`[messaging] /threads returned ${res.status}; retrying with /mine alias`);
    res = await apiFetch("/api/messaging/mine", {
      method: "GET",
      token,
    });
  }
  const data = (await parseJson(res)) as {
    threads?: MessagingThreadSummary[];
    bookingUpdates?: MessagingThreadSummary[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `messaging threads ${res.status}`);
  return {
    threads: data.threads ?? [],
    bookingUpdates: data.bookingUpdates ?? [],
  };
}

export async function getMessagingThread(
  token: string,
  threadId: string,
): Promise<{ thread_id: string; messages: unknown[] }> {
  const res = await apiFetch(`/api/messaging/messages/thread/${encodeURIComponent(threadId)}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as {
    thread_id?: string;
    messages?: unknown[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `messaging thread ${res.status}`);
  return {
    thread_id: String(data.thread_id || threadId),
    messages: data.messages ?? [],
  };
}

/** Row returned by POST /api/messaging/messages (listing thread send, group, etc.). */
export type MessagingMessageRow = {
  id: string;
  sender_id?: string;
  recipient_id?: string | null;
  group_id?: string | null;
  parent_message_id?: string | null;
  /** API alias for `parent_message_id` (which message this one quotes / replies to). */
  reply_to_message_id?: string | null;
  thread_id?: string | null;
  message_type?: string;
  subject?: string | null;
  content?: string;
  is_read?: boolean;
  created_at?: string;
  updated_at?: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_message?: {
    id?: string;
    sender_id?: string;
    content_snippet?: string;
    message_type?: string;
    created_at?: string;
  } | null;
  reactions?: Array<{ emoji: string; count: number; includes_me?: boolean }>;
};

export async function postMessagingMessage(
  token: string,
  body: {
    recipient_id?: string;
    group_id?: string;
    message_type: string;
    /** Optional; DMs omit subject (stored empty). Group messages may use a topic line. */
    subject?: string;
    content: string;
    thread_id?: string;
    /** Quotes / threads this send under an existing bubble (persisted as `parent_message_id`). */
    reply_to_message_id?: string;
  },
): Promise<MessagingMessageRow> {
  const res = await apiFetch("/api/messaging/messages", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok)
    throw new Error((data as ApiError)?.error || `messaging send ${res.status}`);
  return data as MessagingMessageRow;
}

export async function postMessagingReaction(token: string, messageId: string, emoji: string): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "POST",
    token,
    body: JSON.stringify({ emoji }),
  });
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `reaction add ${res.status}`);
}

export async function deleteMessagingReaction(token: string, messageId: string, emoji: string): Promise<void> {
  const res = await apiFetch(
    `/api/messaging/messages/${encodeURIComponent(messageId)}/reactions?emoji=${encodeURIComponent(emoji)}`,
    { method: "DELETE", token },
  );
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `reaction remove ${res.status}`);
}

/** PUT /api/messaging/messages/:id — edit own message (same id, thread preserved). */
export async function patchMessagingMessage(
  token: string,
  messageId: string,
  body: { subject?: string; content?: string },
): Promise<MessagingMessageRow> {
  const res = await apiFetch(`/api/messaging/messages/${encodeURIComponent(messageId)}`, {
    method: "PUT",
    token,
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `messaging edit ${res.status}`);
  return data as MessagingMessageRow;
}

/** DELETE /api/messaging/messages/:id — soft-delete own message (removed for everyone in thread). */
export async function deleteMessagingMessage(token: string, messageId: string): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
    token,
  });
  if (res.status === 204) return;
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `messaging delete ${res.status}`);
}

/** POST …/hide-for-me — hide message from this user's thread only. */
export async function hideMessagingMessageForMe(token: string, messageId: string): Promise<void> {
  const res = await apiFetch(
    `/api/messaging/messages/${encodeURIComponent(messageId)}/hide-for-me`,
    { method: "POST", token },
  );
  if (res.status === 204) return;
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `messaging hide ${res.status}`);
}

/** DELETE …/hide-for-me — reverse hide-for-me (show message again in my thread). */
export async function unhideMessagingMessageForMe(token: string, messageId: string): Promise<void> {
  const res = await apiFetch(
    `/api/messaging/messages/${encodeURIComponent(messageId)}/hide-for-me`,
    { method: "DELETE", token },
  );
  if (res.status === 204) return;
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `messaging unhide ${res.status}`);
}

/** GET …/thread/:id/hidden-for-me — messages this user hid in this thread (compact recovery list). */
export async function getMessagingThreadHiddenForMe(
  token: string,
  threadId: string,
): Promise<{ thread_id: string; messages: unknown[] }> {
  const res = await apiFetch(
    `/api/messaging/messages/thread/${encodeURIComponent(threadId)}/hidden-for-me`,
    { method: "GET", token },
  );
  const data = (await parseJson(res)) as {
    thread_id?: string;
    messages?: unknown[];
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `messaging hidden list ${res.status}`);
  return {
    thread_id: String(data.thread_id || threadId),
    messages: data.messages ?? [],
  };
}

export type MessagingGroupMemberRow = { user_id: string; role: string; joined_at?: string };

export type MessagingGroupDetail = {
  id: string;
  name: string;
  description?: string | null;
  created_by?: string;
  members?: MessagingGroupMemberRow[];
};

export async function createMessagingGroup(
  token: string,
  body: { name: string; description?: string },
): Promise<MessagingGroupDetail> {
  const res = await apiFetch("/api/messaging/messages/groups", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as MessagingGroupDetail & ApiError;
  if (!res.ok) throw new Error(data?.error || `create group ${res.status}`);
  return data as MessagingGroupDetail;
}

export async function getMessagingGroup(token: string, groupId: string): Promise<MessagingGroupDetail> {
  const res = await apiFetch(`/api/messaging/messages/groups/${encodeURIComponent(groupId)}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as MessagingGroupDetail & ApiError;
  if (!res.ok) throw new Error(data?.error || `get group ${res.status}`);
  return data as MessagingGroupDetail;
}

export async function addMessagingGroupMember(
  token: string,
  groupId: string,
  user_id: string,
): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    token,
    body: JSON.stringify({ user_id }),
  });
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `add group member ${res.status}`);
}

export async function kickMessagingGroupMember(
  token: string,
  groupId: string,
  user_id: string,
): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/groups/${encodeURIComponent(groupId)}/kick`, {
    method: "POST",
    token,
    body: JSON.stringify({ user_id }),
  });
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `kick group member ${res.status}`);
}

export async function archiveMessagingThread(token: string, threadId: string): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/thread/${encodeURIComponent(threadId)}/archive`, {
    method: "POST",
    token,
  });
  if (res.status === 204) return;
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `archive thread ${res.status}`);
}

export async function unarchiveMessagingThread(token: string, threadId: string): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/thread/${encodeURIComponent(threadId)}/archive`, {
    method: "DELETE",
    token,
  });
  if (res.status === 204) return;
  const data = (await parseJson(res)) as ApiError;
  if (!res.ok) throw new Error(data?.error || `unarchive thread ${res.status}`);
}

export async function deleteMessagingThreadForUser(token: string, threadId: string): Promise<void> {
  const res = await apiFetch(`/api/messaging/messages/thread/${encodeURIComponent(threadId)}/delete`, {
    method: "POST",
    token,
  });
  const data = (await parseJson(res)) as ApiError & { thread_id?: string };
  if (res.status === 201 || res.status === 204) return;
  if (!res.ok) throw new Error(data?.error || `delete thread ${res.status}`);
}

export type EmailDeliveryMode = "unconfigured" | "test_sink" | "self_hosted_smtp" | "provider";

export type SmsDeliveryMode = "unconfigured" | "mock" | "self_hosted_gateway" | "provider";

export type ExternalContactCapabilities = {
  email_smtp_configured: boolean;
  /** @deprecated use email_delivery_mode */
  email_test_sink: boolean;
  email_delivery_mode: EmailDeliveryMode;
  sms_delivery_mode: SmsDeliveryMode;
  /** @deprecated use sms_delivery_mode */
  sms_mode: "twilio_live" | "mock" | "self_hosted_gateway" | "unavailable";
  /** Mode vs transport mismatch hints from messaging-service (no secrets). */
  delivery_warnings: string[];
};

export async function getMessagingExternalContactCapabilities(
  token: string,
): Promise<ExternalContactCapabilities> {
  const res = await apiFetch("/api/messaging/messages/external-contact/capabilities", {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as ExternalContactCapabilities & { error?: string };
  if (!res.ok) throw new Error(data?.error || `capabilities ${res.status}`);
  const modeRaw = String((data as { email_delivery_mode?: string }).email_delivery_mode || "").toLowerCase();
  let email_delivery_mode: EmailDeliveryMode;
  if (
    modeRaw === "test_sink" ||
    modeRaw === "provider" ||
    modeRaw === "unconfigured" ||
    modeRaw === "self_hosted_smtp"
  ) {
    email_delivery_mode = modeRaw;
  } else if (!data.email_smtp_configured) {
    email_delivery_mode = "unconfigured";
  } else if (data.email_test_sink) {
    email_delivery_mode = "test_sink";
  } else {
    email_delivery_mode = "self_hosted_smtp";
  }
  const smsRaw = String((data as { sms_delivery_mode?: string }).sms_delivery_mode || "").toLowerCase();
  let sms_delivery_mode: SmsDeliveryMode;
  if (smsRaw === "mock" || smsRaw === "provider" || smsRaw === "unconfigured" || smsRaw === "self_hosted_gateway") {
    sms_delivery_mode = smsRaw;
  } else {
    const legacy = data.sms_mode;
    if (legacy === "mock") sms_delivery_mode = "mock";
    else if (legacy === "twilio_live") sms_delivery_mode = "provider";
    else if (legacy === "self_hosted_gateway") sms_delivery_mode = "self_hosted_gateway";
    else sms_delivery_mode = "unconfigured";
  }
  const sms_mode =
    data.sms_mode === "twilio_live" || data.sms_mode === "mock" || data.sms_mode === "self_hosted_gateway"
      ? data.sms_mode
      : sms_delivery_mode === "provider"
        ? "twilio_live"
        : sms_delivery_mode === "mock"
          ? "mock"
          : sms_delivery_mode === "self_hosted_gateway"
            ? "self_hosted_gateway"
            : "unavailable";
  const delivery_warnings = Array.isArray((data as { delivery_warnings?: unknown }).delivery_warnings)
    ? (data as { delivery_warnings: string[] }).delivery_warnings.filter((x) => typeof x === "string")
    : [];
  return {
    email_smtp_configured: Boolean(data.email_smtp_configured),
    email_test_sink: Boolean(data.email_test_sink),
    email_delivery_mode,
    sms_delivery_mode,
    sms_mode,
    delivery_warnings,
  };
}

/** `send_ok`: transport accepted / real path (false for dev_mock SMS or failed SMTP/SMS with persisted history). */
export type ExternalContactSendResult = {
  send_ok: boolean;
  id?: string;
  status?: string;
  created_at?: string;
  error?: string;
  message?: string;
  history?: Record<string, unknown>;
  email_delivery?: string;
  email_delivery_mode?: EmailDeliveryMode;
  sms_delivery?: string;
  sms_delivery_mode?: SmsDeliveryMode;
};

export async function submitMessagingExternalContact(
  token: string,
  body: {
    contact_method: "email" | "sms";
    recipient_email?: string;
    recipient_phone?: string;
    subject?: string;
    body: string;
    listing_id?: string;
  },
): Promise<ExternalContactSendResult> {
  const res = await apiFetch("/api/messaging/messages/external-contact", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    id?: string;
    status?: string;
    created_at?: string;
    error?: string;
    message?: string;
    email_delivery?: string;
    email_delivery_mode?: string;
    sms_delivery?: string;
    sms_delivery_mode?: string;
    send_ok?: boolean;
    history?: Record<string, unknown>;
  };
  const parseEmailMode = (raw: string): EmailDeliveryMode | undefined => {
    const r = raw.toLowerCase();
    return r === "test_sink" || r === "provider" || r === "unconfigured" || r === "self_hosted_smtp" ? r : undefined;
  };
  const parseSmsMode = (raw: string): SmsDeliveryMode | undefined => {
    const r = raw.toLowerCase();
    return r === "mock" || r === "provider" || r === "unconfigured" || r === "self_hosted_gateway" ? r : undefined;
  };
  if (res.status === 502 && data?.history && typeof data.history === "object") {
    return {
      send_ok: false,
      error: String(data.message || data.error || "send_failed").trim(),
      message: data.message ? String(data.message) : undefined,
      history: data.history,
      email_delivery_mode: parseEmailMode(String(data.email_delivery_mode || "")),
      sms_delivery_mode: parseSmsMode(String(data.sms_delivery_mode || "")),
    };
  }
  if (!res.ok) {
    const msg = (data?.message || data?.error || `external contact ${res.status}`).trim();
    throw new Error(msg);
  }
  const transportOk = data.send_ok !== false;
  return {
    send_ok: transportOk,
    id: String(data.id || ""),
    status: String(data.status || "queued"),
    created_at: String(data.created_at || ""),
    message: data.message ? String(data.message) : undefined,
    email_delivery: data.email_delivery,
    email_delivery_mode: parseEmailMode(String(data.email_delivery_mode || "")),
    sms_delivery: data.sms_delivery,
    sms_delivery_mode: parseSmsMode(String(data.sms_delivery_mode || "")),
  };
}

export type ExternalContactHistoryRow = {
  id: string;
  contact_method: "email" | "sms";
  recipient_email?: string | null;
  recipient_phone?: string | null;
  subject?: string | null;
  body: string;
  status: string;
  created_at: string;
  sent_at?: string | null;
  delivery_error?: string | null;
  provider_message_id?: string | null;
};

export async function listMessagingExternalContacts(
  token: string,
  limit = 30,
): Promise<ExternalContactHistoryRow[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const res = await apiFetch(`/api/messaging/messages/external-contact?limit=${safeLimit}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: ExternalContactHistoryRow[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `external contact list ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function searchMessagingUsers(
  token: string,
  q: string,
): Promise<MessagingUserSearchResult[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const res = await apiFetch(`/api/messaging/messages/users/search?q=${encodeURIComponent(query)}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { users?: MessagingUserSearchResult[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `messaging user search ${res.status}`);
  return Array.isArray(data.users) ? data.users : [];
}

export async function listFraudCases(
  token: string,
  opts?: { page?: number; pageSize?: number; minScore?: number },
): Promise<{ cases: FraudCaseRow[]; totalCount: number; page: number; totalPages: number }> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 24;
  const minScore = opts?.minScore ?? 60;
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    minScore: String(minScore),
  });
  const res = await apiFetch(`/api/booking/fraud-cases?${qs}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as {
    cases?: FraudCaseRow[];
    totalCount?: number;
    page?: number;
    totalPages?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `fraud cases ${res.status}`);
  return {
    cases: data.cases ?? [],
    totalCount: Number(data.totalCount ?? 0),
    page: Number(data.page ?? page),
    totalPages: Number(data.totalPages ?? 0),
  };
}

export async function fraudCaseAction(
  token: string,
  bookingId: string,
  action: "reviewed" | "ignore" | "ban",
): Promise<{ ok?: boolean; action?: string; error?: string }> {
  const res = await apiFetch(`/api/booking/fraud-cases/${encodeURIComponent(bookingId)}/action`, {
    method: "POST",
    token,
    body: JSON.stringify({ action }),
  });
  const data = (await parseJson(res)) as { ok?: boolean; action?: string; error?: string };
  if (!res.ok) throw new Error(data?.error || `fraud action ${res.status}`);
  return data;
}

export type ModerationDashboard = {
  pendingBookings: number;
  fraudFlags: number;
  communityReports: number;
  pendingBookingRows?: PendingBookingRow[];
};

export async function getModerationDashboard(token: string): Promise<ModerationDashboard> {
  const res = await apiFetch(`/api/dashboard/moderation`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as ModerationDashboard & ApiError;
  if (!res.ok) throw new Error(data?.error || `moderation dashboard ${res.status}`);
  return {
    pendingBookings: Number(data.pendingBookings ?? 0),
    fraudFlags: Number(data.fraudFlags ?? 0),
    communityReports: Number(data.communityReports ?? 0),
    pendingBookingRows: data.pendingBookingRows ?? [],
  };
}

export async function acceptBooking(
  token: string,
  bookingId: string,
): Promise<{ status: string; from?: string; to?: string }> {
  const res = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}/accept`, {
    method: "POST",
    token,
  });
  const data = (await parseJson(res)) as { status?: string; from?: string; to?: string; error?: string };
  if (!res.ok) throw new Error(data?.error || `accept booking ${res.status}`);
  return { status: String(data.status || ""), from: data.from, to: data.to };
}

export async function createListing(
  token: string,
  body: {
    title: string;
    description?: string;
    price_cents: number;
    effective_from: string;
    effective_until?: string;
    /** `paused` saves a draft (not shown on marketplace); `active` publishes. */
    initial_status?: "active" | "paused";
    amenities?: string[];
    smoke_free?: boolean;
    pet_friendly?: boolean;
    furnished?: boolean;
    residence_type?: string;
    size_sqft?: number | null;
    square_feet?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state_or_province?: string | null;
    postal_code?: string | null;
    country?: string | null;
    neighborhood?: string | null;
    display_location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    /** At least one https image URL required by listings-service. */
    images?: string[];
    image_url?: string;
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

export type MyListingSummary = {
  id: string;
  title: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  price_cents?: number;
  price_usd_monthly?: number | null;
  residence_type?: string | null;
  square_feet?: number | null;
  location?: string | null;
  watch_count?: number;
  description?: string | null;
  amenities?: unknown;
};

export async function listMyListings(token: string): Promise<MyListingSummary[]> {
  const res = await apiFetch("/api/listings/mine", { method: "GET", token });
  const data = (await parseJson(res)) as { items?: MyListingSummary[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `list my listings ${res.status}`);
  return Array.isArray(data.items) ? data.items : [];
}

/** Landlord: update listing fields (title, description, price, amenities, location, …). */
export async function listListingRevisions(
  token: string,
  listingId: string,
): Promise<
  Array<{
    id: string;
    editor_user_id: string;
    snapshot: unknown;
    changes?: unknown;
    created_at: string;
  }>
> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}/revisions`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: unknown[]; error?: string };
  if (!res.ok) throw new Error(data?.error || `list revisions ${res.status}`);
  const raw = Array.isArray(data.items) ? data.items : [];
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id || ""),
      editor_user_id: String(row.editor_user_id || ""),
      snapshot: row.snapshot,
      changes: row.changes,
      created_at: String(row.created_at || ""),
    };
  });
}

export async function postListingMedia(
  token: string,
  listingId: string,
  body: { media_url: string; media_type: "image" | "video"; sort_order?: number },
): Promise<{ media: Record<string, unknown>; listing: ListingJson }> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}/media`, {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as {
    media?: Record<string, unknown>;
    listing?: ListingJson;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `listing media ${res.status}`);
  return {
    media: data.media ?? {},
    listing: (data.listing ?? {}) as ListingJson,
  };
}

export async function deleteListingMedia(
  token: string,
  listingId: string,
  mediaId: string,
): Promise<ListingJson> {
  const res = await apiFetch(
    `/api/listings/listings/${encodeURIComponent(listingId)}/media/${encodeURIComponent(mediaId)}`,
    { method: "DELETE", token },
  );
  const data = (await parseJson(res)) as { listing?: ListingJson; error?: string };
  if (!res.ok) throw new Error(data?.error || `delete listing media ${res.status}`);
  return (data.listing ?? {}) as ListingJson;
}

export async function reorderListingMedia(
  token: string,
  listingId: string,
  orderedMediaIds: string[],
): Promise<ListingJson> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}/media-order`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ ordered_media_ids: orderedMediaIds }),
  });
  const data = (await parseJson(res)) as { listing?: ListingJson; error?: string };
  if (!res.ok) throw new Error(data?.error || `reorder listing media ${res.status}`);
  return (data.listing ?? {}) as ListingJson;
}

export async function patchMyListing(
  token: string,
  listingId: string,
  body: Record<string, unknown>,
): Promise<ListingJson> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as ListingJson & ApiError;
  if (!res.ok) throw new Error(data?.error || `patch listing ${res.status}`);
  return data as ListingJson;
}

/** Soft-delete: listing removed from search/mine; retained in DB. */
export async function deleteMyListing(token: string, listingId: string): Promise<{ ok: boolean; id: string }> {
  const res = await apiFetch(`/api/listings/listings/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
    token,
  });
  const data = (await parseJson(res)) as { ok?: boolean; id?: string; error?: string };
  if (!res.ok) throw new Error(data?.error || `delete listing ${res.status}`);
  return { ok: Boolean(data.ok), id: String(data.id || listingId) };
}

export async function patchListingStatus(
  token: string,
  listingId: string,
  status: "active" | "paused" | "archived",
): Promise<{ id: string; status: string; version?: number }> {
  const res = await apiFetch(
    `/api/listings/listings/${encodeURIComponent(listingId)}/status`,
    {
      method: "PATCH",
      token,
      body: JSON.stringify({ status }),
    },
  );
  const data = (await parseJson(res)) as {
    id?: string;
    status?: string;
    version?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `patch listing status ${res.status}`);
  return {
    id: String(data.id || listingId),
    status: String(data.status || ""),
    version: data.version,
  };
}

export async function mediaUploadTokenized(
  token: string,
  file: File,
): Promise<{ mediaId: string; url: string }> {
  const create = await apiFetch("/api/media/media/upload-url", {
    method: "POST",
    token,
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    }),
  });
  const createData = (await parseJson(create)) as {
    mediaId?: string;
    media_id?: string;
    uploadUrl?: string;
    upload_url?: string;
    error?: string;
  };
  const mediaId = createData.mediaId ?? createData.media_id;
  const uploadUrl = createData.uploadUrl ?? createData.upload_url;
  if (!create.ok || !mediaId || !uploadUrl) {
    throw new Error(createData.error || `media upload init ${create.status}`);
  }
  const bytes = await file.arrayBuffer();
  const putHeaders: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
  };
  /** Same-origin inline upload (DB fallback) is authorized via Bearer; S3 presigned URLs do not need it. */
  if (uploadUrl.startsWith("/")) {
    putHeaders.Authorization = `Bearer ${token}`;
  }
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: putHeaders,
    body: bytes,
  });
  if (!put.ok) throw new Error(`media binary upload ${put.status}`);

  const complete = await apiFetch(`/api/media/media/${encodeURIComponent(mediaId)}/complete`, {
    method: "POST",
    token,
  });
  if (!complete.ok) {
    const cd = (await parseJson(complete)) as { error?: string };
    throw new Error(cd.error || `media complete ${complete.status}`);
  }

  const dl = await apiFetch(`/api/media/media/${encodeURIComponent(mediaId)}/download-url`, {
    method: "GET",
    token,
  });
  const dlData = (await parseJson(dl)) as { download_url?: string; downloadUrl?: string; error?: string };
  const downloadUrl = dlData.download_url ?? dlData.downloadUrl;
  if (!dl.ok || !downloadUrl) {
    throw new Error(dlData.error || `media download-url ${dl.status}`);
  }
  return { mediaId, url: downloadUrl };
}

export async function attachListingMedia(
  token: string,
  listingId: string,
  mediaUrl: string,
  sortOrder = 0,
  mediaType: "image" | "video" = "image",
): Promise<ListingJson> {
  const { listing } = await postListingMedia(token, listingId, {
    media_url: mediaUrl,
    sort_order: sortOrder,
    media_type: mediaType,
  });
  return listing;
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

export type TrustPublicUserMatch = {
  id: string;
  username?: string | null;
  display_name?: string | null;
};

/** Public username / display handle → user id (no auth). Gateway must allow GET /api/trust/public/users/resolve. */
export async function resolveTrustPublicUserHandle(query: string): Promise<TrustPublicUserMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await apiFetch(
    `/api/trust/public/users/resolve?q=${encodeURIComponent(q)}`,
    { method: "GET" },
  );
  const data = (await parseJson(res)) as {
    data?: { matches?: TrustPublicUserMatch[] };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `resolve user ${res.status}`);
  return Array.isArray(data.data?.matches) ? data.data!.matches! : [];
}

export async function getReputation(userId: string) {
  const res = await apiFetch(
    `/api/trust/reputation/${encodeURIComponent(userId)}`,
  );
  const data = (await parseJson(res)) as {
    data?: {
      user_id?: string;
      score?: number;
      review_count?: number;
      avg_rating?: number | null;
    };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `reputation ${res.status}`);
  return {
    user_id: data.data?.user_id ?? userId,
    score: data.data?.score ?? 0,
    review_count: data.data?.review_count ?? 0,
    avg_rating: data.data?.avg_rating ?? null,
  };
}

export type TrustReviewRow = {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewer_username?: string | null;
  reviewer_display_name?: string | null;
  target_type: string;
  target_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

/** Public: peer reviews received by or written by a user (trust-service HTTP). */
export async function listUserTrustReviews(
  userId: string,
  opts?: { direction?: "received" | "written"; limit?: number },
): Promise<{ user_id: string; direction: string; items: TrustReviewRow[] }> {
  const direction = opts?.direction ?? "received";
  const limit = opts?.limit ?? 50;
  const res = await apiFetch(
    `/api/trust/user-reviews/${encodeURIComponent(userId)}?direction=${encodeURIComponent(direction)}&limit=${encodeURIComponent(String(limit))}`,
  );
  const data = (await parseJson(res)) as {
    data?: { user_id?: string; direction?: string; items?: TrustReviewRow[] };
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `user reviews ${res.status}`);
  const items = Array.isArray(data.data?.items) ? data.data!.items! : [];
  return {
    user_id: String(data.data?.user_id ?? userId),
    direction: String(data.data?.direction ?? direction),
    items: items.map((r) => ({
      id: String(r.id || ""),
      booking_id: String(r.booking_id || ""),
      reviewer_id: String(r.reviewer_id || ""),
      target_type: String(r.target_type || ""),
      target_id: String(r.target_id || ""),
      rating: Number(r.rating) || 0,
      comment: r.comment != null ? String(r.comment) : null,
      created_at: String(r.created_at || ""),
    })),
  };
}

/** Batch public reputation reads for search cards (avg peer-review stars + count). */
export async function enrichListingsWithHostReputation(items: ListingJson[]): Promise<ListingJson[]> {
  const ids = Array.from(
    new Set(items.map((i) => String(i.user_id || "").trim()).filter(Boolean)),
  );
  if (!ids.length) return items;
  const map = new Map<string, { avg: number | null; count: number }>();
  await Promise.all(
    ids.map(async (uid) => {
      try {
        const r = await getReputation(uid);
        map.set(uid, { avg: r.avg_rating ?? null, count: r.review_count ?? 0 });
      } catch {
        map.set(uid, { avg: null, count: 0 });
      }
    }),
  );
  return items.map((it) => {
    const uid = String(it.user_id || "").trim();
    const h = uid ? map.get(uid) : undefined;
    if (!h) return it;
    return { ...it, host_avg_rating: h.avg, host_review_count: h.count };
  });
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
    search_history_available?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data?.error || `search summary ${res.status}`);
  return {
    user_id: data.user_id,
    items: data.items ?? [],
    search_history_available: data.search_history_available !== false,
  };
}

export type ListingFeelErrorContext = {
  /** Client aborted (browser timeout). */
  aborted?: boolean;
  /** HTTP status from edge/gateway/analytics when known. */
  httpStatus?: number;
};

/** Honest, specific copy for listing-feel failures (client timeout vs upstream vs transport). */
export function humanizeListingFeelError(raw: string, ctx?: ListingFeelErrorContext): string {
  if (ctx?.aborted) {
    return "Analysis timed out before the server finished (often a cold model load). Wait a few seconds and try again.";
  }
  const st = ctx?.httpStatus;
  if (st === 503 || st === 502) {
    return "The analysis service is temporarily unavailable. Try again in a moment.";
  }
  if (st === 504) {
    return "The analysis request timed out at the gateway. Retry once—long prompts can exceed edge limits.";
  }
  if (st === 408 || st === 499) {
    return "The analysis request was cancelled or timed out. Retry shortly.";
  }
  const s = String(raw || "").trim();
  if (!s) return "Quick analysis is not available right now.";
  const low = s.toLowerCase();
  if (low.includes("x-user-id must match") || low.includes("forbidden"))
    return "We could not verify your session for this request. Try refreshing the page.";
  if (low.includes("401") || low.includes("missing token") || low.includes("invalid token"))
    return "Sign in to use listing insights, or refresh your session.";
  if (low.includes("502") || low.includes("503") || low.includes("upstream"))
    return "The analysis service is busy. Please try again in a moment.";
  if (low.includes("timed out") || low.includes("timeout") || low.includes("aborterror") || low.includes("timeouterror"))
    return "Analysis timed out on the server. If this is the first run after deploy, wait and retry once.";
  if (low.includes("failed to fetch") || low.includes("load failed") || low.includes("networkerror"))
    return "The browser could not complete the request (offline or TLS/proxy). Check connectivity and retry.";
  if (low.includes("listing_fetch_failed"))
    return "We could not load this listing for analysis.";
  if (s.length > 160) return "Quick analysis is not available right now.";
  return s;
}

/** Hide internal `model_used` values from primary UI (e.g. soft-degraded responses still set `error-degraded`). */
export function formatListingFeelModelForUi(model_used: string | undefined | null): string | null {
  const m = String(model_used ?? "").trim();
  if (!m) return null;
  const low = m.toLowerCase();
  if (
    low === "error-degraded" ||
    low === "unavailable" ||
    low === "none" ||
    low === "rule-based-fallback"
  ) {
    return null;
  }
  return m;
}

/** Canonical edge path: POST `/api/analytics/insights/listing-feel` (gateway strips `/api/analytics` → analytics `POST /insights/listing-feel`). */
export type ListingFeelTimingPayload = {
  http_handler_wall_ms?: number;
  http_gateway_overhead_ms?: number;
  path?: string;
  server_ms?: number;
  cache_hit?: boolean;
  ollama_sum_ms?: number;
  li_v2_wall_ms?: number;
  legacy_ollama_http_ms?: number;
  prompt_build_ms?: number;
  post_process_ms?: number;
  response_bytes_approx?: number;
  ollama_warm?: string;
  prompt_chars?: number;
  truncated?: boolean;
  max_tokens?: number;
  analysis_depth?: string;
};

export async function analyzeListingFeel(
  token: string | null,
  body: {
    title: string;
    description?: string;
    price_cents: number;
    audience?: "landlord" | "renter";
    analysis_depth?: "quick" | "standard" | "deep";
    /** Optional; improves cache correlation and diagnostics server-side. */
    listing_id?: string;
  },
  opts?: { timeoutMs?: number; signal?: AbortSignal },
) {
  try {
    const depth = body.analysis_depth ?? "standard";
    const timeoutMs =
      opts?.timeoutMs ??
      (depth === "quick" ? 300_000 : depth === "deep" ? 360_000 : 320_000);
    const signal =
      opts?.signal ??
      (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined);
    const res = await apiFetch("/api/analytics/insights/listing-feel", {
      method: "POST",
      token: token ?? undefined,
      body: JSON.stringify(body),
      signal,
    });
    const data = (await parseJson(res)) as {
      analysis_text?: string;
      model_used?: string;
      quality_score?: number;
      intelligence_json?: string;
      confidence_explanation?: string;
      listing_feel_timing?: ListingFeelTimingPayload;
      error?: string;
    };
    if (!res.ok) {
      return {
        analysis_text: "",
        model_used: "unavailable",
        quality_score: 0,
        error: humanizeListingFeelError(String((data as { error?: string })?.error || `listing feel ${res.status}`), {
          httpStatus: res.status,
        }),
      };
    }
    const errRaw = String((data as { error?: string }).error || "").trim();
    if (errRaw && !(String(data.analysis_text || "").trim())) {
      return {
        ...data,
        analysis_text: "",
        error: humanizeListingFeelError(errRaw, { httpStatus: res.status }),
      };
    }
    return data;
  } catch (e: unknown) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
    const aborted = name === "AbortError" || name === "TimeoutError";
    return {
      analysis_text: "",
      model_used: "unavailable",
      quality_score: 0,
      error: humanizeListingFeelError(aborted ? "listing feel timed out" : e instanceof Error ? e.message : "listing feel failed", {
        aborted,
      }),
    };
  }
}
