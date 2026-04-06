# Data modeling — raster exports (PNG)

**Single folder** for all diagram PNGs: **`diagrams/data-modeling/png/`**

`make generate-architecture` **clears** this folder first (`make clean-data-modeling-png`), then regenerates every raster so **no stale files** remain from renames or removed diagrams.

```bash
make generate-architecture
```

**§2.1 grading package** (copies PNG + class **XMI** + `MANIFEST.json` into one folder with **`SUBMISSION.md`**):

```bash
make bundle-2.1-submission
```

→ `docs/architecture-submission/2.1-architecture-diagram/`

Or separately: `make generate-diagrams` (Graphviz), `make generate-uml` (PlantUML), or **`make clean-data-modeling-png`** alone before a full regen.

---

## Graphviz (`make generate-diagrams`)

| PNG | Diagram |
|-----|---------|
| `unified-logical-er.png` | System-level logical ER |
| `domain.png` | Domain concept graph |
| `data-flow.png` | Runtime topology (Kafka broker health via `KAFKA_BROKER_STATUS_JSON`) |
| `system-architecture-poster.png` | Stack poster |
| `physical-auth.png` … `physical-media.png` | Per-service physical ER + heat (needs Postgres on dev ports) |

---

## PlantUML (`make generate-uml`)

**C4:** `c4-context.png`, `c4-container.png`, `c4-components-<service>.png` (each notes **proto** + HTTP/gRPC split).

**UML class (per service):** `uml-class-gateway.png`, `uml-class-auth.png`, `uml-class-booking.png`, … — **LLD** boxes list **proto** RPCs and **`server.ts` / `grpc-server.ts`**.

| PNG prefix | Content |
|------------|---------|
| `uml-class-*` | Class-level LLD per service / gateway |
| `uml-sequence-*` | Core flows |
| `uml-state-booking-lifecycle.png` | Booking state machine |
| `uml-component-system.png` | Platform components + HTTP/gRPC legend |

Sources: `diagrams/c4/**/*.puml`, `diagrams/uml/**/*.puml`. See [`scripts/plantuml/README.md`](../../scripts/plantuml/README.md).

**Docker:** `PLANTUML_DOCKER=1 make generate-uml` if `plantuml` is not installed locally.

**Optional vector / XMI:** `PLANTUML_EXTRA_FORMATS=svg,xmi bash scripts/plantuml/render-all.sh` → `svg-uml/`, `xmi-uml/`.

---

## SVG sources (Graphviz)

Graphviz **SVG** lives beside DOT: `diagrams/domain/`, `diagrams/flow/`, `diagrams/poster/`, `diagrams/physical/`.
