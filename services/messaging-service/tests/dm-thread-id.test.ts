import { describe, expect, it } from "vitest";
import {
  sqlHumanDirectConversationId,
  sqlHumanPairConversationId,
  stableHumanDmThreadId,
} from "../src/lib/dm-thread-id.js";

describe("stableHumanDmThreadId", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";

  it("is symmetric in participant order", () => {
    expect(stableHumanDmThreadId(a, b)).toEqual(stableHumanDmThreadId(b, a));
  });

  it("is distinct for different pairs", () => {
    const c = "33333333-3333-4333-8333-333333333333";
    expect(stableHumanDmThreadId(a, b)).not.toEqual(stableHumanDmThreadId(a, c));
  });

  it("returns a lowercase RFC UUID string", () => {
    const id = stableHumanDmThreadId(a, b);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("sqlHumanPairConversationId", () => {
  it("is pair-only v5 (no thread_id) so inbox cannot split on corrupt thread_id", () => {
    const sql = sqlHumanPairConversationId("m");
    expect(sql).toContain("uuid_generate_v5");
    expect(sql).toContain("'dm:'");
    expect(sql.toLowerCase()).not.toContain("coalesce");
  });
});

describe("sqlHumanDirectConversationId", () => {
  it("still prefers thread_id for booking/system bucket keys", () => {
    const sql = sqlHumanDirectConversationId("b");
    expect(sql).toContain("COALESCE");
    expect(sql).toContain("thread_id::text");
  });
});
