import { describe, expect, it } from "vitest";
import {
  landlordSurfaceWhereClause,
  surfaceWhereClause,
  userSurfaceWhereClause,
} from "../src/notification-visibility.js";
import { bookingContextMatchForBookingSql } from "../src/booking-context-sql.js";

describe("notification scope parity", () => {
  it("list and unread-count share surfaceWhereClause for user and landlord", () => {
    expect(surfaceWhereClause("user")).toBe(userSurfaceWhereClause());
    expect(surfaceWhereClause("landlord")).toBe(landlordSurfaceWhereClause());
    expect(surfaceWhereClause("all")).toContain("user_id = $1::uuid");
  });

  it("user surface excludes landlord booking rows from the global bell", () => {
    const userSql = userSurfaceWhereClause();
    expect(userSql).toContain("booking_landlord");
    expect(userSql).toContain("notification_audience");
    expect(userSql).toContain("NOT LIKE 'booking.%'");
  });

  it("landlord surface includes landlord booking rows", () => {
    const landlordSql = landlordSurfaceWhereClause();
    expect(landlordSql).toContain("booking_landlord");
    expect(landlordSql).toContain("booking.%");
  });
});

describe("bookingContextMatchForBookingSql", () => {
  it("matches context_id, payload booking ids, deep_link, payload::text, and dedupe_key", () => {
    const sql = bookingContextMatchForBookingSql("n", "$2");
    expect(sql).toContain("context_id");
    expect(sql).toContain("booking_id");
    expect(sql).toContain("bookingId");
    expect(sql).toContain("deep_link");
    expect(sql).toContain("payload::text");
    expect(sql).toContain("dedupe_key");
  });
});
