/**
 * One-shot run of the transactional outbox publisher (Kafka publish + published_at).
 * Run in-cluster: kubectl exec deploy/auth-service -c app -- node dist/cli/outbox-tick-once.js
 */
import { PrismaClient } from "@prisma/client";
import { runAuthOutboxPublisherTick } from "../lib/auth-outbox-publisher.js";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await runAuthOutboxPublisherTick(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("outbox-tick-once:", e);
  process.exit(1);
});
