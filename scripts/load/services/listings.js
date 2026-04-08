/**
 * Listings service paths for vertical envelope / catalog (GET only).
 * Used by tooling; k6-service-envelope.js reads ENDPOINT_PATH from env per run.
 */
export const endpoints = [
  { name: "healthz", method: "GET", path: "/api/listings/healthz" },
  { name: "search", method: "GET", path: "/api/listings/search?q=test" },
];
