import type { Server as HttpServer, IncomingMessage } from "http";
import type { RedisClientType } from "redis";
import { WebSocketServer, WebSocket } from "ws";
import { verifyJwt } from "@common/utils/auth";

type JwtPayload = { sub?: string };

type RealtimeEnvelope = {
  type: "notification";
  userId: string;
  payload: Record<string, unknown>;
};

function extractToken(req: IncomingMessage): string | null {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice("bearer ".length).trim();
  }
  const rawUrl = String(req.url || "");
  const idx = rawUrl.indexOf("?");
  if (idx === -1) return null;
  const query = new URLSearchParams(rawUrl.slice(idx + 1));
  const token = query.get("token");
  return token?.trim() || null;
}

export function setupRealtimeWebSocket(server: HttpServer, redis: RedisClientType): void {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const socketsByUser = new Map<string, Set<WebSocket>>();

  const subscribe = redis.duplicate();
  subscribe.on("error", (e) => console.error("[gateway-ws] redis subscribe error", e));
  void subscribe.connect().then(async () => {
    await subscribe.subscribe("notification.created.realtime", (message) => {
      try {
        const parsed = JSON.parse(message) as RealtimeEnvelope;
        if (parsed.type !== "notification" || !parsed.userId) return;
        const sockets = socketsByUser.get(parsed.userId);
        if (!sockets?.size) return;
        const out = JSON.stringify({ type: "notification", payload: parsed.payload });
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN) ws.send(out);
        }
      } catch (e) {
        console.error("[gateway-ws] message parse failed", e);
      }
    });
  }).catch((e) => console.error("[gateway-ws] redis subscribe connect failed", e));

  wss.on("connection", (ws, req) => {
    const token = extractToken(req);
    if (!token) {
      ws.close(1008, "missing token");
      return;
    }
    let payload: JwtPayload;
    try {
      payload = verifyJwt(token) as JwtPayload;
    } catch {
      ws.close(1008, "invalid token");
      return;
    }
    const userId = String(payload.sub || "").trim();
    if (!userId) {
      ws.close(1008, "invalid subject");
      return;
    }
    const set = socketsByUser.get(userId) || new Set<WebSocket>();
    set.add(ws);
    socketsByUser.set(userId, set);
    ws.send(JSON.stringify({ type: "connected", userId }));

    ws.on("close", () => {
      const group = socketsByUser.get(userId);
      if (!group) return;
      group.delete(ws);
      if (!group.size) socketsByUser.delete(userId);
    });
  });
}
