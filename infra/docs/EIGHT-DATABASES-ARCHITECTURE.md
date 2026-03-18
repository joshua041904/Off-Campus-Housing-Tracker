# Eight-Database Architecture (Port → Service → Database Name)

We run **8 separate PostgreSQL instances** (one per service) for isolation, tuning, and scaling. Each port corresponds to one logical “database” for that service.

## Intended mapping (port → service → database name)

| Port | Service           | Intended DB name   | Schema(s) used in SQL           | Notes |
|------|-------------------|--------------------|----------------------------------|-------|
| 5433 | records           | `records`          | `records`, `auth`, `listings`, `analytics` (03) | Main app DB; 03-database.sql + extensions |
| 5434 | social            | `records` or `social` | `forum`, etc. (04-social-*)     | Social/forum; migrations say “social DB” |
| 5435 | listings          | `records` or `listings` | `listings` (05-*, 06-*, 08-*) | Listings; migrations say “listings DB” |
| **5436** | **shopping**  | **`shopping`**     | **`shopping`** (06, 07, 08, 09) | **Shopping service: cart, orders, wishlist, etc. Intended DB name is `shopping`, not `records`.** |
| **5437** | **auth**      | **`auth`**           | **`auth`** (07-auth-*)         | **Auth service: database name `auth`; run 00-create-auth-database.sql then 07-auth-*.sql on 5437/auth.** |
| 5438 | auction-monitor    | `postgres`         | (07-auction-monitor-*)          | Uses default DB name in config |
| 5439 | analytics         | `analytics`       | (08-analytics-*)                | Analytics-specific DB name |
| 5440 | python-ai         | `python_ai`       | (09-python-ai-*)                | Python AI service |

## Why port 5436 should use database name `shopping`

- **Migrations** say “Run on PostgreSQL port 5436 (shopping **database**)” (e.g. `06-shopping-schema.sql`, `07-shopping-orders-migration.sql`, `08-shopping-notes-migration.sql`, `09-shopping-order-number-sequence.sql`). That implies the **database** on that instance should be named `shopping`.
- **Eight separate DBs**: each service has its own instance; the shopping instance (5436) should own a database named `shopping` with the `shopping` schema and tables (`shopping.orders`, `shopping.shopping_cart`, etc.), not a database named `records`.
- **Confusion today**: app and config currently point to **5436/records** (database name `records` on port 5436). That likely came from copying the “records” pattern from other ports. The DB named `shopping` on 5436 is often never created or never migrated, so it has no `shopping.orders` and is unused. That mismatch can cause:
  - Scripts that assume “5436 = shopping DB” to skip applying migrations to the DB the app actually uses (5436/records).
  - Confusion when debugging (e.g. “shopping DB” vs “records on shopping port”).
  - Order-number/sequence scripts applying to 5436/records and 5436/postgres but not to a proper 5436/shopping.

## Correct setup for port 5436 (shopping)

1. **Create** the database `shopping` on the instance listening on port 5436 (e.g. `createdb -h localhost -p 5436 -U postgres shopping` or run `infra/db/00-create-shopping-database.sql` against `postgres` on 5436).
2. **Run migrations** on **5436/shopping** in order:
   - `06-shopping-schema.sql`
   - `07-shopping-orders-migration.sql`
   - `08-shopping-notes-migration.sql`
   - `09-shopping-order-number-sequence.sql` (or use `scripts/ensure-shopping-order-number-sequence.sh`).
3. **Point the app** at **5436/shopping**: set `POSTGRES_URL_SHOPPING` to `...:5436/shopping` (not `...:5436/records`).
4. **Ensure script**: `scripts/ensure-shopping-order-number-sequence.sh` should treat **5436/shopping** as the primary DB for `shopping.orders` and apply the sequence there.

## Schema reference (shopping, port 5436)

- **Schema**: `shopping` (created by `06-shopping-schema.sql`).
- **Tables**: `shopping.shopping_cart`, `shopping.watchlist`, `shopping.recently_viewed`, `shopping.wishlist`, `shopping.purchase_history`, `shopping.search_history`, `shopping.cache_metadata`; plus `shopping.orders` from `07-shopping-orders-migration.sql`.
- **Sequence**: `shopping.order_number_seq` (09) used by `shopping.generate_order_number()` for `order_number` (ORD-YYYY-NNNNNN).
- **Other migrations**: `08-shopping-notes-migration.sql` (notes on cart); `10-content-hash-migrations.sql` can touch shopping schema.

## If you already have data in 5436/records

- **Option A**: Migrate existing data from 5436/records (schema `shopping`) into 5436/shopping, then switch the app to 5436/shopping and stop using 5436/records for shopping.
- **Option B**: Keep using 5436/records until you schedule a migration; document that “current deployment uses 5436/records for shopping” and that 5436/shopping is the target. Ensure script and app can stay on 5436/records until migration is done.

This doc is the single place that defines the intended 8-DB layout and that **5436 = shopping instance → database name `shopping`**.

## Inventory: what each instance actually has

To see **all 8 instances** (databases, schemas, tables, approximate row counts) and a clear mapping:

```bash
./scripts/inventory-all-databases.sh [OUTPUT_DIR]
```

- **OUTPUT_DIR** optional; default is `bench_logs/db-inventory-YYYYMMDD-HHMMSS` or `/tmp/db-inventory-*`.
- Requires: `psql`, `PGPASSWORD=postgres`, and host access to `localhost:5433–5440` (Docker Compose Postgres up).

Outputs:

| File        | Contents |
|------------|----------|
| `full.log` | Per port: every database, its schemas, every table with `pg_stat_user_tables.n_live_tup` (approx rows). |
| `mapping.txt` | One line per port: Port \| Service \| Intended DB \| Env var \| List of DBs on that instance. |
| `summary.txt` | Port → Service → Intended DB → Env table + “what each service uses” (app-config). |

Use this to confirm which DB each service connects to and what data lives where (e.g. 5436/shopping vs 5436/records, 5437/auth vs 5437/records).
