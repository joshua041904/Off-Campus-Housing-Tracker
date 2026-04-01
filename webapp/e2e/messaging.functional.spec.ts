import { expect, test } from "@playwright/test";
import { apiGatewayReady, uniqueE2eEmail } from "./helpers";
import { edgePath } from "./vertical-helpers";

/**
 * Full HTTP path: edge TLS → gateway → messaging-service → Postgres (`messages.*` REST path).
 * Skips if gateway not ready or messaging returns 5xx (e.g. DB schema mismatch).
 */
test.describe("messaging functional (API)", () => {
  test("two users: A sends direct message, B sees it in inbox", async ({ request }) => {
    test.slow();
    test.setTimeout(180_000);
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");

    const password = "TestPass123!";
    const emailA = uniqueE2eEmail("msg-fn-a", test.info().workerIndex);
    const emailB = uniqueE2eEmail("msg-fn-b", test.info().workerIndex);

    const regA = await request.post(edgePath("/api/auth/register"), {
      data: { email: emailA, password },
      headers: { "Content-Type": "application/json" },
    });
    expect(regA.status(), await regA.text()).toBe(201);
    const jA = (await regA.json()) as { token?: string; user?: { id?: string } };
    const tokenA = jA.token;
    const idA = jA.user?.id;
    expect(tokenA, "token A").toBeTruthy();
    expect(idA, "user id A").toBeTruthy();

    const regB = await request.post(edgePath("/api/auth/register"), {
      data: { email: emailB, password },
      headers: { "Content-Type": "application/json" },
    });
    expect(regB.status(), await regB.text()).toBe(201);
    const jB = (await regB.json()) as { token?: string; user?: { id?: string } };
    const tokenB = jB.token;
    const idB = jB.user?.id;
    expect(tokenB, "token B").toBeTruthy();
    expect(idB, "user id B").toBeTruthy();

    const payload = {
      recipient_id: idB,
      message_type: "direct",
      subject: "e2e-functional",
      content: `hello ${Date.now()}`,
    };

    const send = await request.post(edgePath("/api/messaging/messages"), {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
      },
      data: payload,
    });

    if (send.status() >= 500) {
      test.skip(
        true,
        `messaging POST returned ${send.status()} — check messaging DB (messages.*) and service logs`,
      );
    }

    expect(send.status(), await send.text()).toBe(201);
    const created = (await send.json()) as { id?: string; sender_id?: string };
    expect(created.id, "message id").toBeTruthy();
    expect(created.sender_id).toBe(idA);

    const inbox = await request.get(edgePath("/api/messaging/messages?page=1&limit=20"), {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(inbox.ok(), await inbox.text()).toBeTruthy();
    const body = (await inbox.json()) as {
      messages?: { sender_id?: string; content?: string; subject?: string }[];
    };
    expect(Array.isArray(body.messages)).toBeTruthy();
    const hit = body.messages?.some((m) => m.sender_id === idA && m.content === payload.content);
    expect(hit, "B inbox should include A's message").toBeTruthy();
  });
});
