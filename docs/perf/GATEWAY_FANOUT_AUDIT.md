# Gateway Fanout Audit

Audit gateway routes for serial fanout and N+1 calls.

## Route Audit Table

| Route | Downstream Calls | Sequential? | Parallelizable? | Fix |
|---|---|---|---|---|
| `<route>` | `<svcA, svcB, svcC>` | `<yes/no>` | `<yes/no>` | `<Promise.all / batch / cache>` |

## Anti-pattern: Sequential Await

```ts
const listings = await listingsService.search();
const analytics = await analyticsService.batch(listings.ids);
const trust = await trustService.batch(listings.ids);
```

Total latency tends toward sum of each call.

## Preferred: Parallel Fanout

```ts
const listings = await listingsService.search();
const [analytics, trust] = await Promise.all([
  analyticsService.batch(listings.ids),
  trustService.batch(listings.ids),
]);
```

Total latency tends toward max(child call).

## N+1 Detection

Bad:

```ts
for (const listing of listings) {
  await analyticsService.getOne(listing.id);
}
```

Fix:

```ts
await analyticsService.batch(listings.map((l) => l.id));
```

## Checklist

- [ ] No sequential fanout where independent calls exist.
- [ ] No per-item downstream calls in loops.
- [ ] Batch APIs exist for analytics/trust/read-heavy joins.
- [ ] Route timeout budgets reflect parallelized critical path.
