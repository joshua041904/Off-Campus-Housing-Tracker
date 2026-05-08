import { describe, expect, it } from "vitest";
import { createGatewayRedis, shouldUseNoopGatewayRedis } from "../src/gateway-redis.js";

/** Vitest `env.OCH_DISABLE_EXTERNALS=1` in vitest.config.ts — noop path must work without DNS. */
describe("gateway-redis noop", () => {
  it("createGatewayRedis is noop and supports get/eval/connect", async () => {
    expect(shouldUseNoopGatewayRedis()).toBe(true);
    const r = createGatewayRedis("redis://unused:9");
    await r.connect();
    expect(r.isOpen).toBe(true);
    expect(await r.get("any")).toBeNull();
    const ok = await r.eval("return 1", { keys: ["k"], arguments: ["1", "10"] });
    expect(Number(ok)).toBe(1);
    await r.disconnect();
    expect(r.isOpen).toBe(false);
  });
});
