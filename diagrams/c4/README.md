# C4-style diagrams (PlantUML)

Plain PlantUML (no external C4 stdlib URL) so builds stay **offline-deterministic**. Semantics match **C4 levels 1–3**.

| File | Level |
|------|--------|
| `context.puml` | System context |
| `container.puml` | Containers |
| `components/*.puml` | Per-service components |

PNG output: **`../data-modeling/png/c4-*.png`** via `make generate-uml`.
