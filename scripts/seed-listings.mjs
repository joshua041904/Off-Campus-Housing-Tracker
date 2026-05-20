#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const base = (process.env.E2E_API_BASE || "https://off-campus-housing.test").replace(/\/$/, "");
const count = Math.max(1, Number.parseInt(process.env.SEED_LISTINGS_COUNT || process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] || "12", 10) || 12);
const prefix = process.env.SEED_LISTINGS_PREFIX || `seed-${Date.now()}`;
const password = process.env.SEED_LISTINGS_PASSWORD || "Password123!";
const email = `${prefix}-landlord-${randomUUID().slice(0, 8)}@example.com`;
const campusLat = Number.parseFloat(process.env.SEED_CAMPUS_LAT || "42.3868");
const campusLng = Number.parseFloat(process.env.SEED_CAMPUS_LNG || "-72.5301");

const AREA_LABELS = [
  "Near campus",
  "Downtown",
  "West End",
  "North Amherst",
  "East Hadley",
  "Pine Street area",
];

function seededLatLng(index) {
  const radiusMiles = 0.4 + (index % 8) * 0.55; // 0.4..4.25 miles around campus
  const theta = ((index * 137.5) % 360) * (Math.PI / 180);
  const deltaLat = (radiusMiles * Math.cos(theta)) / 69;
  const deltaLng = (radiusMiles * Math.sin(theta)) / (69 * Math.cos((campusLat * Math.PI) / 180));
  return {
    latitude: Number((campusLat + deltaLat).toFixed(6)),
    longitude: Number((campusLng + deltaLng).toFixed(6)),
    display_location: `${AREA_LABELS[index % AREA_LABELS.length]}, Amherst, MA`,
  };
}

async function jsonOrEmpty(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function authToken() {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const regJson = await jsonOrEmpty(reg);
  if (regJson?.token) return regJson.token;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await jsonOrEmpty(login);
  if (!loginJson?.token) throw new Error("unable to obtain auth token for listings seed");
  return loginJson.token;
}

async function main() {
  const token = await authToken();
  let created = 0;
  for (let i = 0; i < count; i += 1) {
    const { latitude, longitude, display_location } = seededLatLng(i);
    const resp = await fetch(`${base}/api/listings/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: `${i + 1} bed ${prefix}-${i}`,
        description: `${i + 1} bed ${i % 3 === 0 ? 2 : 1} bath seeded listing ${prefix}`,
        price_cents: 120000 + i * 10000,
        effective_from: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
        amenities: ["wifi", "parking"],
        smoke_free: true,
        pet_friendly: false,
        furnished: i % 2 === 0,
        latitude,
        longitude,
        display_location,
        images: [
          `https://picsum.photos/seed/${encodeURIComponent(prefix)}-${i}/1200/800`,
        ],
      }),
    });
    if (resp.ok) created += 1;
  }
  console.log(JSON.stringify({ ok: true, base, prefix, requested: count, created, email }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
