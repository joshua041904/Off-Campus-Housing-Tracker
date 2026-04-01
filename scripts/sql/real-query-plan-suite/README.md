# Real query plan suite

Read-only(ish) **`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`** templates aligned to **OCH** schemas under `infra/db/`.

## Caveats

- **Small / empty dev DBs** → sequential scans and “fast” plans that **do not** predict production. Seed **50k–200k+** rows per hot table before trusting cardinality.
- **`ANALYZE`** executes the inner query; keep probes bounded (`LIMIT`, selective predicates).
- Some scripts use `\set ON_ERROR_STOP off` when a legacy schema may be missing.

## Run one file

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f scripts/sql/real-query-plan-suite/01-listings-search.sql
```

## Run all (writes Markdown report)

```bash
./scripts/run-real-query-plan-suite.sh
# → reports/real-query-plans-<timestamp>.md
```

Environment: `SKIP_EXPLAIN_ANALYZE=1` uses **`EXPLAIN` only** (no execution).
