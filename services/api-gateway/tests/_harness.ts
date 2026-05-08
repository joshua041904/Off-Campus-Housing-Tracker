/**
 * Branch-forcing helpers for api-gateway Vitest (upstream / Redis / limits).
 */
import { vi } from "vitest";

export function upstreamOk(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  });
}

export function upstreamError(msg: string) {
  return vi.fn().mockRejectedValue(new Error(msg));
}

export function mockRedisGet(v: string | null) {
  return vi.fn().mockResolvedValue(v);
}

export function mockRedisEval(n: number) {
  return vi.fn().mockResolvedValue(n);
}
