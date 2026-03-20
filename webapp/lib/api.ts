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
  init: RequestInit & { token?: string | null } = {}
): Promise<Response> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
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
  const data = (await parseJson(res)) as { token?: string; user?: unknown; error?: string };
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
  if (data.requiresMFA) throw new Error("MFA required — use a test account without MFA for the webapp demo.");
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
  }
) {
  const res = await apiFetch("/api/booking/search-history", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `search-history ${res.status}`);
  return data;
}

export async function listSearchHistory(token: string, limit = 25) {
  const res = await apiFetch(`/api/booking/search-history/list?limit=${limit}`, {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: unknown[] };
  if (!res.ok) throw new Error((data as ApiError)?.error || `list search-history ${res.status}`);
  return data.items ?? [];
}

export async function watchlistAdd(token: string, listingId: string, source?: string) {
  const res = await apiFetch("/api/booking/watchlist/add", {
    method: "POST",
    token,
    body: JSON.stringify({ listingId, source: source ?? "webapp" }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `watchlist add ${res.status}`);
  return data;
}

export async function watchlistRemove(token: string, listingId: string) {
  const res = await apiFetch("/api/booking/watchlist/remove", {
    method: "POST",
    token,
    body: JSON.stringify({ listingId }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error((data as ApiError)?.error || `watchlist remove ${res.status}`);
  return data;
}

export async function watchlistList(token: string) {
  const res = await apiFetch("/api/booking/watchlist/list", {
    method: "GET",
    token,
  });
  const data = (await parseJson(res)) as { items?: unknown[] };
  if (!res.ok) throw new Error((data as ApiError)?.error || `watchlist list ${res.status}`);
  return data.items ?? [];
}
