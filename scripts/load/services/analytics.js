export const endpoints = [
  { name: "healthz", method: "GET", path: "/api/analytics/healthz" },
  {
    name: "daily-metrics",
    method: "GET",
    path: "/api/analytics/daily-metrics?date=REPLACE_ANALYTICS_DATE",
  },
];
