# Listings Filter API Contract

Endpoint: `GET /api/listings/search`

This endpoint is exposed through the gateway and backed by `listings-service`.

## Query Parameters

- `min_price` (`number`, optional): minimum rent in cents.
- `max_price` (`number`, optional): maximum rent in cents.
- `bedrooms` (`number`, optional): exact bedroom count.
- `amenities` (`string`, optional): comma-separated amenities, for example `laundry,parking,wifi`.
- `available_from` (`ISO date`, optional): listing must be available by this date.
- `sort` (`string`, optional): `price_asc`, `price_desc`, `newest`.
- `cursor` (`string`, optional): opaque pagination cursor.
- `limit` (`number`, optional): page size, default `20`.

## Example Request

`GET /api/listings/search?min_price=90000&max_price=150000&bedrooms=2&amenities=laundry,parking&sort=price_asc&limit=20`

## Response Shape

```json
{
  "data": [
    {
      "id": "uuid",
      "coverImageUrl": "...",
      "price": 1200,
      "bedrooms": 2,
      "bathrooms": 1,
      "distanceToCampusMiles": 0.3,
      "amenities": ["laundry", "parking"],
      "availableFrom": "2026-08-01"
    }
  ],
  "nextCursor": "opaque-string",
  "totalApprox": 142
}
```

Notes:

- `items` is also returned today for backward compatibility.
- `nextCursor` is null when no additional page exists.
