import type { Prisma } from "../prisma/generated/client/index.js";

export type BookingMineView = "active" | "past" | "all" | "dashboard";

/** Search dashboard Recent bookings: confirmed / awaiting landlord only (no draft `created`). */
export const DASHBOARD_RECENT_BOOKING_STATUSES = [
  "pending_confirmation",
  "confirmed",
] as const;

/** Prisma enum values that count as dashboard “active/upcoming”. */
export const ACTIVE_BOOKING_STATUSES = [
  "created",
  "pending_confirmation",
  "confirmed",
] as const;

export const PAST_TERMINAL_BOOKING_STATUSES = [
  "cancelled",
  "rejected",
  "expired",
  "completed",
] as const;

export function bookingMineViewFromQuery(raw: unknown): BookingMineView {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "active" || v === "past" || v === "all" || v === "dashboard") return v;
  return "all";
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isActiveBookingStatus(status: string): boolean {
  const u = String(status || "")
    .trim()
    .toLowerCase();
  return (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(u);
}

export function isPastBookingStatus(status: string): boolean {
  const u = String(status || "")
    .trim()
    .toLowerCase();
  return (PAST_TERMINAL_BOOKING_STATUSES as readonly string[]).includes(u);
}

function viewClauses(
  view: BookingMineView,
  today: Date,
): Prisma.BookingWhereInput[] {
  if (view === "active") {
    return [
      { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
      { endDate: { gte: today } },
    ];
  }
  if (view === "dashboard") {
    return [
      { status: { in: [...DASHBOARD_RECENT_BOOKING_STATUSES] } },
      { endDate: { gte: today } },
    ];
  }
  return [
    {
      OR: [
        { status: { in: [...PAST_TERMINAL_BOOKING_STATUSES] } },
        { endDate: { lt: today } },
      ],
    },
  ];
}

/**
 * Apply view filter. When `baseWhere` is `{ OR: [...] }` (tenant id + username snapshot),
 * distribute view constraints onto each OR branch — Prisma otherwise returns zero rows for
 * `(OR ...) AND status AND endDate` on some nested shapes.
 */
export function applyBookingMineViewFilter(
  baseWhere: Prisma.BookingWhereInput,
  view: BookingMineView,
  now: Date = new Date(),
): Prisma.BookingWhereInput {
  if (view === "all") return baseWhere;
  const today = startOfUtcDay(now);
  const clauses = viewClauses(view, today);

  const orBranches = baseWhere.OR;
  if (orBranches && Array.isArray(orBranches) && orBranches.length > 0) {
    return {
      OR: orBranches.map((branch) => ({
        AND: [branch, ...clauses],
      })),
    };
  }

  return {
    AND: [baseWhere, ...clauses],
  };
}

export function bookingMineOrderBy(
  view: BookingMineView,
): Prisma.BookingOrderByWithRelationInput[] {
  if (view === "active" || view === "dashboard") {
    return [{ startDate: "asc" }, { updatedAt: "desc" }];
  }
  return [{ createdAt: "desc" }];
}
