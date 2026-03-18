# Architecture Rules — Anti-Drift Doctrine

These rules keep the platform coherent across proto, events, DBs, and gateway. Every dev must follow them. No exceptions without an explicit architecture decision.

---

## Rule 1 — Proto is the contract

- No DB field is exposed in proto unless intentional (no implementation leakage).
- Proto changes that break compatibility require a **version bump** (e.g. new message or new field number).
- No destructive field changes (no rename/remove without a new version).

---

## Rule 2 — Event is immutable

- Events are **never** updated or deleted for content changes.
- New meaning ⇒ **increment event version** (same topic/type, version field in envelope).
- Additive changes only within a version (optional/new fields).

---

## Rule 3 — No dual writes

- If a service needs to influence another domain, it **emits an event**; the other service **consumes** and updates its own DB.
- **Never** write into another service’s DB. Never cross-DB writes.

---

## Rule 4 — DB per service

- One database per service (or per bounded context). No cross-database foreign keys.
- No cross-schema hacks. No shared migrations across services.

---

## Rule 5 — Gateway is the only public entry

- All external traffic goes through the **API gateway**. No direct service exposure to the internet.
- No bypassing auth (JWT verification at gateway). No internal ports exposed publicly.

---

## Rule 6 — Kafka is not RPC

- Do **not** wait on Kafka events for the user’s response. Synchronous flows use **gRPC**.
- Async side effects (notifications, analytics, projections) use **Kafka**. Fire-and-forget from the request path.

---

## Rule 7 — State machines enforced in DB

- Business invariants (e.g. booking state transitions) are enforced in the **DB** (e.g. triggers) and in the **service layer**.
- Never rely only on the frontend for state rules.

---

## Rule 8 — Observability required

- All services must log **correlation_id**, **entity_id** (when applicable), and **event_type** (when applicable).
- Health checks must reflect **readiness** (DB, Kafka producer/consumer where used), not just “process is up”.

---

## Where to look

- **Proto ↔ DB ↔ events:** docs/HOUSING_ARCHITECTURE_CONTRACT.md, proto/ and proto/events/.
- **Kafka:** docs/KAFKA_STRATEGY.md, docs/KAFKA_TOPICS_AND_PARTITIONS.md, docs/EVENT_VERSIONING_AND_TRACING.md.
- **Gateway:** docs/GATEWAY_POLICY.md.
- **Search:** docs/SEARCH_ARCHITECTURE.md.
- **Service auth and errors:** docs/SERVICE_AUTH_AND_ERRORS.md (mTLS, service identity, capability matrix, gRPC error mapping, structured errors).
