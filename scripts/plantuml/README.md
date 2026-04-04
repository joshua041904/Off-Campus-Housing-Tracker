# PlantUML rendering

Sources live under **`diagrams/uml/`** and **`diagrams/c4/`**. **All PNGs** are written to **`diagrams/data-modeling/png/`** with flattened names:

- `uml-class-booking.png`, `uml-sequence-create-booking.png`, `c4-container.png`, `c4-components-booking.png`, …

## Run

```bash
make generate-uml
# or
bash scripts/plantuml/render-all.sh
```

**Local:** install [PlantUML](https://plantuml.com/) and Graphviz (`brew install plantuml graphviz`).

**Docker (no local install):**

```bash
PLANTUML_DOCKER=1 bash scripts/plantuml/render-all.sh
```

## Optional exports

```bash
PLANTUML_EXTRA_FORMATS=svg,xmi bash scripts/plantuml/render-all.sh
```

Produces `diagrams/data-modeling/svg-uml/` and `diagrams/data-modeling/xmi-uml/` where supported.

## Determinism

`.puml` files are **version-controlled** and curated from this repo’s **TypeScript services**, **Prisma** schemas (`services/*/prisma/schema.prisma`), and **proto** contracts. Regenerate PNGs after changing sources; there is no runtime code parser in CI (keeps the pipeline stable).
