-- Deterministic coordinates near default campus for rows missing geo (distance sort / radius filters).
UPDATE listings.listings l
SET
  latitude = 42.3868 + ((mod(abs(hashtext(l.id::text || ':lat')), 20001))::double precision / 1000000.0 - 0.01),
  longitude = -72.5301 + ((mod(abs(hashtext(l.id::text || ':lon')), 20001))::double precision / 1000000.0 - 0.01)
WHERE (l.latitude IS NULL OR l.longitude IS NULL)
  AND l.deleted_at IS NULL;
