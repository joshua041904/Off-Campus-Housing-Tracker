import type { PrismaClient, SearchHistory } from "../prisma/generated/client/index.js";

/** Default campus point (matches listings-service search / distance logic). */
const CAMPUS_LAT = 42.3868;
const CAMPUS_LNG = -72.5301;

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 3958.7613; // Earth radius miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

export function milesFromCampus(lat: number | null, lng: number | null): number | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return haversineMiles(lat, lng, CAMPUS_LAT, CAMPUS_LNG);
}

export type NewListingSavedSearchPayload = {
  listing_id: string;
  landlord_user_id: string;
  title: string;
  price_cents: number;
  residence_type?: string | null;
  size_sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string | null;
};

function filtersObj(row: SearchHistory): Record<string, unknown> {
  const f = row.filters;
  if (f && typeof f === "object" && !Array.isArray(f)) return f as Record<string, unknown>;
  return {};
}

function rowMatchesListing(row: SearchHistory, listing: NewListingSavedSearchPayload): boolean {
  if (String(row.userId) === String(listing.landlord_user_id)) return false;

  const price = Number(listing.price_cents || 0);
  if (row.minPriceCents != null && price < row.minPriceCents) return false;
  if (row.maxPriceCents != null && price > row.maxPriceCents) return false;

  const miles = milesFromCampus(
    listing.latitude != null ? Number(listing.latitude) : null,
    listing.longitude != null ? Number(listing.longitude) : null,
  );
  if (row.maxCampusMiles != null && Number.isFinite(row.maxCampusMiles) && row.maxCampusMiles > 0) {
    if (miles == null) return false;
    if (miles > row.maxCampusMiles) return false;
  }

  const f = filtersObj(row);
  const rt = String(listing.residence_type || "").toLowerCase();
  const typesRaw = f.residence_types ?? f.residenceTypes;
  if (Array.isArray(typesRaw) && typesRaw.length > 0) {
    const allowed = new Set(typesRaw.map((x) => String(x).toLowerCase()));
    if (rt && !allowed.has(rt)) return false;
  }
  const singleRt = f.residence_type != null ? String(f.residence_type).toLowerCase() : "";
  if (singleRt && rt !== singleRt) return false;

  const minBeds = f.min_bedrooms ?? f.bedrooms;
  if (minBeds != null && Number.isFinite(Number(minBeds))) {
    const lb = listing.bedrooms != null ? Number(listing.bedrooms) : null;
    if (lb == null || lb < Number(minBeds)) return false;
  }

  const minSqft = f.min_sqft ?? f.minSqft;
  if (minSqft != null && Number.isFinite(Number(minSqft))) {
    const sq = listing.size_sqft != null ? Number(listing.size_sqft) : null;
    if (sq == null || sq < Number(minSqft)) return false;
  }

  const maxSqft = f.max_sqft ?? f.maxSqft;
  if (maxSqft != null && Number.isFinite(Number(maxSqft))) {
    const sq = listing.size_sqft != null ? Number(listing.size_sqft) : null;
    if (sq == null || sq > Number(maxSqft)) return false;
  }

  return true;
}

export async function notifyUsersForNewListingSavedSearches(
  prisma: PrismaClient,
  listing: NewListingSavedSearchPayload,
): Promise<{ notified: number }> {
  const st = String(listing.status || "active").toLowerCase();
  if (st !== "active") return { notified: 0 };

  const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const rows = await prisma.searchHistory.findMany({
    where: {
      alertOnMatch: true,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 1500,
  });

  const notifiedUsers = new Set<string>();
  let notified = 0;
  const base = (process.env.NOTIFICATION_HTTP || "").replace(/\/$/, "");
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  if (!base || !secret) {
    return { notified: 0 };
  }

  for (const row of rows) {
    if (!rowMatchesListing(row, listing)) continue;
    const uid = String(row.userId);
    if (notifiedUsers.has(uid)) continue;
    notifiedUsers.add(uid);
    const miles = milesFromCampus(
      listing.latitude != null ? Number(listing.latitude) : null,
      listing.longitude != null ? Number(listing.longitude) : null,
    );
    const reasonParts: string[] = ["Matched your saved search alerts"];
    if (row.maxCampusMiles != null && miles != null) {
      reasonParts.push(`within ${row.maxCampusMiles} mi of campus (listing ≈ ${miles.toFixed(1)} mi)`);
    }
    if (row.minPriceCents != null || row.maxPriceCents != null) {
      reasonParts.push("within your saved price range");
    }
    const f = filtersObj(row);
    if (f.residence_types || f.residence_type) {
      reasonParts.push("matching your residence type filter");
    }
    const payload = {
      listing_id: listing.listing_id,
      title: listing.title,
      saved_search_id: row.id,
      reason: reasonParts.join("; "),
      max_campus_miles: row.maxCampusMiles,
      distance_miles_to_campus: miles,
    };
    try {
      const r = await fetch(`${base}/internal/push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-booking-internal-secret": secret,
        },
        body: JSON.stringify({
          user_id: uid,
          event_type: "saved_search.new_listing",
          payload,
        }),
      });
      if (r.ok) notified += 1;
    } catch {
      /* non-fatal */
    }
  }
  return { notified };
}
