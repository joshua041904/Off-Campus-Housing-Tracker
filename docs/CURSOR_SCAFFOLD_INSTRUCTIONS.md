# Cursor scaffold instructions — housing-platform

Drop this into Cursor as the scaffolding instruction when building from the substrate bundle.

---

You are setting up a new repository: housing-platform.

Follow ARCHITECTURE.md strictly.

Tasks:

1. Create pnpm workspace structure:
   - services/
     - common
     - auth-service
     - listings-service
     - booking-service
     - messaging-service
     - notification-service
     - trust-service
     - analytics-service
   - webapp/
   - proto/
   - infra/k8s/base
   - scripts/
   - docs/

2. Create root:
   - package.json (workspace root)
   - pnpm-workspace.yaml
   - tsconfig.base.json
   - docker-compose.yml (Postgres + Kafka + Redis only)

3. Each service must include:
   - package.json
   - tsconfig.json
   - Dockerfile (multi-stage)
   - src/server.ts
   - health endpoint (/health)
   - metrics endpoint (/metrics)
   - Prisma schema
   - Kafka client usage via services/common
   - Logger usage via services/common

4. Implement services/common:
   - Kafka client with SSL/mTLS support
   - Redis client
   - Pino logger
   - Prometheus metrics helper
   - No business logic

5. Enforce:
   - TypeScript strict mode
   - No cross-service imports
   - No shared DB schemas
   - No business logic in gateway

6. Scaffold minimal REST endpoints for each service:
   - auth: register/login
   - listings: create/get listing
   - booking: create booking
   - messaging: send message
   - trust: add review
   - notification: event consumer only
   - analytics: event consumer only

7. Do not over-couple services.
8. Do not create cross-service database queries.
9. Do not introduce synchronous chains between services.
10. Prepare CI-ready Docker builds.

Stop after scaffolding.
Do not implement full business logic.
