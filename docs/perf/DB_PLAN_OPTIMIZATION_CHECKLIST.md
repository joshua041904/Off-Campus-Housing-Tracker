# DB Plan Optimization Checklist

Use this checklist against `run-all-explain.log` for each query.

## Query Review Table

| Query | Problem Node | Missing Index | Estimated Impact |
|---|---|---|---|
| `<query-id>` | `<Seq Scan / Sort / Hash Join / Nested Loop>` | `<index ddl>` | `<low/med/high + note>` |

## A) Sequential Scan Detection

- Is there `Seq Scan` on a large table?
- Compare rows scanned vs rows returned.
- Check filter selectivity.
- If yes: propose index on selective predicate columns.

## B) Sort Without Index

- Is there a `Sort` node on hot path?
- Does `ORDER BY` match an index prefix?
- If no: add composite index matching `WHERE` + `ORDER BY`.

Example:

```sql
CREATE INDEX idx_listings_price_created
ON listings (price_cents, created_at DESC);
```

## C) Hash Join On Large Sets

- Is `Hash Join` used on both large relations?
- Are join keys indexed on both sides?
- If no: add join-key indexes.

## D) Nested Loop On Non-Indexed FK

- Is inner relation repeatedly scanned in nested loop?
- Is FK lookup indexed?
- If no: add FK index.

## E) Multi-Column Filter Fit

For queries like:

```sql
WHERE min_price <= price_cents
  AND max_price >= price_cents
  AND city = $1
```

- Ensure index order follows highest-selectivity equality predicates first.
- Consider expression/partial index if workload is skewed.

## Drift / Status

- [ ] No schema drift detected.
- [ ] Required indexes present in target env.
- [ ] Migration file prepared for each missing index.
