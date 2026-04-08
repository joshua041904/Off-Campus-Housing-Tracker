# UML (PlantUML sources)

| Directory | Contents |
|-----------|-----------|
| **`class/`** | Service-level LLD class diagrams (layers: HTTP/gRPC, domain/Prisma, infrastructure). |
| **`sequence/`** | Critical flows: booking, listing, messaging, moderation, projections, notifications. |
| **`component/`** | System component (mirrors runtime topology). |
| **`state/`** | Aggregate state machines (booking lifecycle matches `BookingStatus` in Prisma). |

Rendered **PNG** output: **`../data-modeling/png/`** with `uml-*` prefixes (`make generate-uml`).
