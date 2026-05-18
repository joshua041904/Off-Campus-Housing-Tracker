import { describe, expect, it } from "vitest";
import {
  ACTIVE_BOOKING_STATUSES,
  applyBookingMineViewFilter,
  bookingMineViewFromQuery,
  isActiveBookingStatus,
  isPastBookingStatus,
  startOfUtcDay,
} from "../src/booking-mine-view.js";

describe("bookingMineViewFromQuery", () => {
  it("parses active, past, all", () => {
    expect(bookingMineViewFromQuery("active")).toBe("active");
    expect(bookingMineViewFromQuery("past")).toBe("past");
    expect(bookingMineViewFromQuery("all")).toBe("all");
    expect(bookingMineViewFromQuery("dashboard")).toBe("dashboard");
    expect(bookingMineViewFromQuery("")).toBe("all");
  });
});

describe("booking status helpers", () => {
  it("maps active-ish prisma statuses", () => {
    expect(isActiveBookingStatus("created")).toBe(true);
    expect(isActiveBookingStatus("pending_confirmation")).toBe(true);
    expect(isActiveBookingStatus("confirmed")).toBe(true);
    expect(isActiveBookingStatus("cancelled")).toBe(false);
    expect(isActiveBookingStatus("expired")).toBe(false);
  });

  it("maps past terminal statuses", () => {
    expect(isPastBookingStatus("cancelled")).toBe(true);
    expect(isPastBookingStatus("expired")).toBe(true);
    expect(isPastBookingStatus("confirmed")).toBe(false);
  });
});

describe("applyBookingMineViewFilter", () => {
  const base = { tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
  const today = startOfUtcDay(new Date("2026-05-16T15:00:00.000Z"));

  it("active requires active status and end_date >= today", () => {
    const w = applyBookingMineViewFilter(base, "active", today);
    expect(w).toMatchObject({
      AND: [
        base,
        { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
        { endDate: { gte: today } },
      ],
    });
  });

  it("past includes terminal status or end before today", () => {
    const w = applyBookingMineViewFilter(base, "past", today);
    const and = (w as { AND: unknown[] }).AND;
    const orClause = and[1] as { OR: unknown[] };
    expect(orClause.OR).toHaveLength(2);
  });

  it("distributes active filter across tenant identity OR branches", () => {
    const w = applyBookingMineViewFilter(
      {
        OR: [
          { tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
          { tenantUsernameSnapshot: { startsWith: "tomwang04312_" } },
        ],
      },
      "active",
      today,
    );
    const or = (w as { OR: Array<{ AND: unknown[] }> }).OR;
    expect(or).toHaveLength(2);
    expect(or[0]?.AND).toHaveLength(3);
    expect(or[1]?.AND).toHaveLength(3);
  });
});
