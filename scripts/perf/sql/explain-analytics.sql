-- analytics DB (5447) — daily_metrics (gateway GET /api/analytics/daily-metrics)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT date, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged
FROM analytics.daily_metrics
WHERE date = CURRENT_DATE;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT event_type, count(*) FROM analytics.events GROUP BY event_type;
