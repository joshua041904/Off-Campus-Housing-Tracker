import { createClient, type RedisClientType } from "redis";

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
let publisher: RedisClientType | null = null;
let attempted = false;

async function getPublisher(): Promise<RedisClientType | null> {
  if (publisher?.isOpen) return publisher;
  if (attempted) return null;
  attempted = true;
  try {
    publisher = createClient({ url: redisUrl, socket: { connectTimeout: 800 } });
    publisher.on("error", () => {});
    await publisher.connect();
    return publisher;
  } catch {
    return null;
  }
}

export async function publishRealtimeNotification(userId: string, payload: Record<string, unknown>): Promise<void> {
  if (!userId) return;
  const client = await getPublisher();
  if (!client?.isOpen) return;
  await client.publish(
    "notification.created.realtime",
    JSON.stringify({
      type: "notification",
      userId,
      payload,
    }),
  );
}
