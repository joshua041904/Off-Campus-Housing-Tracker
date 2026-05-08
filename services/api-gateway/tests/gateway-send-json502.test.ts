/**
 * Branch coverage for `sendJson502` (proxy error path vs socket / headers-sent guards).
 */
import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { describe, it, expect, beforeAll } from "vitest";

describe("sendJson502", () => {
  let sendJson502: (res: ServerResponse | Socket, msg: string) => void;

  beforeAll(async () => {
    const mod = await import("../src/server.js");
    sendJson502 = mod.sendJson502;
  });

  it("writes 502 JSON when headers not sent", () => {
    const chunks: Buffer[] = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader: () => {},
      end: (b: string) => {
        chunks.push(Buffer.from(b));
      },
    } as unknown as ServerResponse;
    sendJson502(res, "upstream error");
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ error: "upstream error" });
  });

  it("no-ops when headers already sent", () => {
    const end = () => {
      throw new Error("should not end");
    };
    const res = {
      headersSent: true,
      statusCode: 200,
      setHeader: () => {},
      end,
    } as unknown as ServerResponse;
    expect(() => sendJson502(res, "x")).not.toThrow();
  });

  it("destroys bare socket-like response", () => {
    const destroyed = { called: false };
    const sock = {
      destroy: () => {
        destroyed.called = true;
      },
    } as unknown as Socket;
    sendJson502(sock, "bye");
    expect(destroyed.called).toBe(true);
  });
});
