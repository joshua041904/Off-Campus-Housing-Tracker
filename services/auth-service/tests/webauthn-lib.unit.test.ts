/**
 * Pure unit tests for `lib/webauthn.ts` (no routes).
 */
import { describe, expect, it } from "vitest";
import {
  verifyWebAuthnRegistration,
  verifyWebAuthnAuthentication,
} from "../src/lib/webauthn.js";

function clientDataB64(
  type: "webauthn.create" | "webauthn.get",
  challengeUtf8: string,
  origin: string,
): string {
  const challenge = Buffer.from(challengeUtf8, "utf8").toString("base64url");
  return Buffer.from(JSON.stringify({ type, challenge, origin }), "utf8").toString("base64url");
}

function authDataWithCred(credId: Buffer): Buffer {
  const rpIdHash = Buffer.alloc(32, 0x01);
  const flags = Buffer.from([0x40]);
  const signCount = Buffer.alloc(4);
  signCount.writeUInt32BE(42, 0);
  const credLen = Buffer.alloc(2);
  credLen.writeUInt16BE(credId.length, 0);
  const cborStub = Buffer.from([0x82, 0x01, 0x02]);
  return Buffer.concat([rpIdHash, flags, signCount, credLen, credId, cborStub]);
}

const origin = "https://rp.example";
const challenge = "fixed-challenge-utf8";

function regResponse(overrides: Partial<{
  id: string;
  rawId: string;
  type: string;
  clientDataJSON: string;
  attestationObject: string;
}> = {}) {
  const cred = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const auth = authDataWithCred(cred);
  const base = {
    id: cred.toString("base64url"),
    rawId: cred.toString("base64url"),
    type: "public-key" as const,
    response: {
      attestationObject: auth.toString("base64url"),
      clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
    },
  };
  return { ...base, ...overrides };
}

describe("lib/webauthn", () => {
  it("verifyWebAuthnRegistration uses fmt none sentinel without packed signature path", async () => {
    const cred = Buffer.from([0xca, 0xfe]);
    const auth = authDataWithCred(cred);
    const prefixed = Buffer.concat([Buffer.from([0xff, 0xfe]), auth]);
    const res = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: prefixed.toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
      },
    };
    const out = await verifyWebAuthnRegistration(res, {
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: "rp.example",
    });
    expect(out.fmt).toBe("none");
  });

  it("verifyWebAuthnRegistration succeeds for packed fmt with aligned authData", async () => {
    const res = regResponse();
    const out = await verifyWebAuthnRegistration(res, {
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: "rp.example",
    });
    expect(out.credentialId).toBe(res.id);
    expect(out.counter).toBe(42);
    expect(out.fmt).toBe("packed");
    expect(out.publicKey.length).toBeGreaterThan(0);
  });

  it("verifyWebAuthnRegistration wraps missing required fields", async () => {
    await expect(
      verifyWebAuthnRegistration(
        { id: "", rawId: "x", type: "public-key", response: { attestationObject: "aa", clientDataJSON: "bb" } },
        { expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: "x" },
      ),
    ).rejects.toThrow(/WebAuthn verification failed:.*required fields/);
  });

  it("verifyWebAuthnRegistration rejects non public-key type", async () => {
    const r = regResponse({ type: "other" as unknown as "public-key" });
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/type must be/);
  });

  it("verifyWebAuthnRegistration rejects wrong clientData type", async () => {
    const cred = Buffer.from([0x01, 0x02]);
    const auth = authDataWithCred(cred);
    const r = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: auth.toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.get", challenge, origin),
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/webauthn\.create/);
  });

  it("verifyWebAuthnRegistration rejects challenge mismatch", async () => {
    const r = regResponse({
      response: {
        attestationObject: authDataWithCred(Buffer.from([1])).toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", "other", origin),
      },
    });
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/Challenge mismatch/);
  });

  it("verifyWebAuthnRegistration rejects origin mismatch", async () => {
    const r = regResponse({
      response: {
        attestationObject: authDataWithCred(Buffer.from([2])).toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", challenge, "https://evil"),
      },
    });
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/Origin mismatch/);
  });

  it("verifyWebAuthnRegistration rejects credential id mismatch", async () => {
    const credInAuth = Buffer.from([9, 9]);
    const rawIdWrong = Buffer.from([1, 2]);
    const auth = authDataWithCred(credInAuth);
    const r = {
      id: credInAuth.toString("base64url"),
      rawId: rawIdWrong.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: auth.toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/Credential ID mismatch/);
  });

  it("verifyWebAuthnRegistration rejects authData without AT flag", async () => {
    const cred = Buffer.from([8]);
    const rpIdHash = Buffer.alloc(32, 0x01);
    const flags = Buffer.from([0x00]);
    const signCount = Buffer.alloc(4);
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(cred.length, 0);
    const badAuth = Buffer.concat([rpIdHash, flags, signCount, credLen, cred, Buffer.from([1])]);
    const r = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: badAuth.toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/Attested credential data not present/);
  });

  it("verifyWebAuthnRegistration rejects attestationObject too short", async () => {
    const cred = Buffer.from([1]);
    const r = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: Buffer.from([1, 2, 3, 4, 5]).toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/too short/);
  });

  it("verifyWebAuthnRegistration rejects invalid clientDataJSON payload", async () => {
    const cred = Buffer.from([3]);
    const auth = authDataWithCred(cred);
    const r = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: auth.toString("base64url"),
        clientDataJSON: Buffer.from("not-json", "utf8").toString("base64url"),
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/WebAuthn verification failed/);
  });

  it("verifyWebAuthnRegistration rejects clientData missing fields", async () => {
    const cred = Buffer.from([4]);
    const auth = authDataWithCred(cred);
    const badCd = Buffer.from(JSON.stringify({ type: "webauthn.create" }), "utf8").toString("base64url");
    const r = {
      id: cred.toString("base64url"),
      rawId: cred.toString("base64url"),
      type: "public-key" as const,
      response: {
        attestationObject: auth.toString("base64url"),
        clientDataJSON: badCd,
      },
    };
    await expect(
      verifyWebAuthnRegistration(r, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
      }),
    ).rejects.toThrow(/missing required fields/);
  });

  it("verifyWebAuthnAuthentication rejects wrong clientData type", async () => {
    const authData = Buffer.concat([Buffer.alloc(32, 1), Buffer.from([0x00]), Buffer.alloc(4)]);
    await expect(
      verifyWebAuthnAuthentication(
        {
          id: "x",
          rawId: "x",
          type: "public-key",
          response: {
            authenticatorData: authData.toString("base64url"),
            clientDataJSON: clientDataB64("webauthn.create", challenge, origin),
            signature: Buffer.from([1, 2]).toString("base64url"),
          },
        },
        {
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: "rp.example",
          publicKey: "pk",
          counter: 1,
        },
      ),
    ).rejects.toThrow(/webauthn\.get/);
  });

  it("verifyWebAuthnAuthentication rejects challenge and origin mismatch and replay", async () => {
    const authData = Buffer.concat([Buffer.alloc(32, 1), Buffer.from([0x00]), Buffer.alloc(4)]);
    authData.writeUInt32BE(10, 33);
    const base = {
      id: "x",
      rawId: "x",
      type: "public-key" as const,
      response: {
        authenticatorData: authData.toString("base64url"),
        clientDataJSON: clientDataB64("webauthn.get", challenge, origin),
        signature: Buffer.from([1]).toString("base64url"),
      },
    };
    await expect(
      verifyWebAuthnAuthentication(base, {
        expectedChallenge: "nope",
        expectedOrigin: origin,
        expectedRPID: "rp.example",
        publicKey: "pk",
        counter: 1,
      }),
    ).rejects.toThrow(/Challenge mismatch/);

    await expect(
      verifyWebAuthnAuthentication(base, {
        expectedChallenge: challenge,
        expectedOrigin: "https://other",
        expectedRPID: "rp.example",
        publicKey: "pk",
        counter: 1,
      }),
    ).rejects.toThrow(/Origin mismatch/);

    await expect(
      verifyWebAuthnAuthentication(base, {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
        publicKey: "pk",
        counter: 50,
      }),
    ).rejects.toThrow(/Counter replay/);
  });

  it("verifyWebAuthnAuthentication succeeds when counter increases", async () => {
    const authData = Buffer.concat([Buffer.alloc(32, 1), Buffer.from([0x00]), Buffer.alloc(4)]);
    authData.writeUInt32BE(99, 33);
    const out = await verifyWebAuthnAuthentication(
      {
        id: "x",
        rawId: "x",
        type: "public-key",
        response: {
          authenticatorData: authData.toString("base64url"),
          clientDataJSON: clientDataB64("webauthn.get", challenge, origin),
          signature: Buffer.from([5]).toString("base64url"),
        },
      },
      {
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "rp.example",
        publicKey: "pk",
        counter: 10,
      },
    );
    expect(out.verified).toBe(true);
    expect(out.newCounter).toBe(99);
  });
});
