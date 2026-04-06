# Database and architecture diagrams (generated)

- **`make generate-diagrams`** — Graphviz (ER, flow, poster, physical) → PNG in **`data-modeling/png/`**.
- **`make generate-uml`** — PlantUML (C4 + UML) → same **`data-modeling/png/`** (`uml-*`, `c4-*`).
- **`make generate-architecture`** — both (full raster bundle).
- **`make generate-architecture-docs`** — diagrams + optional PlantUML + sync `docs/architecture/` + `services/*.md`.

**Requirements:** `psql`, **jq**, **Graphviz** (`dot`), **PlantUML** + Graphviz for UML (`brew install plantuml graphviz` or `PLANTUML_DOCKER=1`). Optional: Postgres on **5441–5448** (physical diagrams skipped if unreachable).

## Where outputs go

| Kind | SVG (vector) | PNG (raster, single folder) |
|------|----------------|------------------------------|
| Unified logical ER | `domain/unified-logical-er.svg` | **`data-modeling/png/unified-logical-er.png`** |
| Domain graph | `domain/domain.svg` | **`data-modeling/png/domain.png`** |
| Data flow / runtime | `flow/data-flow.svg` | **`data-modeling/png/data-flow.png`** |
| System poster | `poster/system-architecture.svg` | **`data-modeling/png/system-architecture-poster.png`** |
| Physical per DB | `physical/<service>.svg` | **`data-modeling/png/physical-<service>.png`** |
| C4 + UML | _(n/a — PlantUML sources only)_ | **`data-modeling/png/c4-*.png`**, **`data-modeling/png/uml-*.png`** |

Details: [`data-modeling/README.md`](./data-modeling/README.md). Sources: [`uml/`](./uml/), [`c4/`](./c4/).

**Shared theme:** [`theme.frag`](./theme.frag) — included inside each `digraph`.

**Environment:**

| Variable | Effect |
|----------|--------|
| `PHYSICAL_HEAT=0` | Disable `pg_stat_user_tables` merge on physical diagrams. |
| `KAFKA_BROKER_STATUS_JSON` | Path to JSON merging **broker health** into the data-flow Kafka cluster (see `scripts/diagram/data/kafka-broker-status*.md`). |
| `UNIFIED_ER_DPI` | PNG DPI for unified logical ER (default 160). |
| `POSTER_DPI` | PNG DPI for poster (default 300). |
| `SKIP_PNG=1` | Only if you call `render.sh` manually without a PNG path — skips raster. |

**Ad-hoc render:** `scripts/diagram/render.sh <dot> <out.svg> <out.png>` — pass explicit PNG path (e.g. under `data-modeling/png/`).

CI: [`.github/workflows/diagrams.yml`](../.github/workflows/diagrams.yml).
