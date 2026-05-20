export type BookingViewerRole = "tenant" | "landlord" | "other";

function statusUpper(raw: string | undefined): string {
  return String(raw || "").trim().toUpperCase();
}

/** Canonical domain status for button gating (handles legacy / mis-cased labels). */
export function bookingStatusForActions(raw: string | undefined): string {
  const upper = statusUpper(raw);
  if (upper === "APPROVED" || upper === "ACCEPTED") return "ACCEPTED";
  if (upper === "PENDING" || upper === "CREATED") return "PENDING";
  if (upper === "DECLINED") return "REJECTED";
  return upper;
}

export function landlordCanRespondToBooking(raw: string | undefined): boolean {
  return bookingStatusForActions(raw) === "PENDING";
}

export function bookingDashboardHrefForRole(role: BookingViewerRole): string {
  switch (role) {
    case "landlord":
      return "/dashboard/landlord";
    case "tenant":
      return "/dashboard/bookings";
    case "other":
      return "/dashboard";
  }
}

export function bookingDashboardHrefForDetail(input: {
  sourceRole: string | null | undefined;
  role: BookingViewerRole;
}): string {
  const source = String(input.sourceRole || "").trim().toLowerCase();
  if (source === "landlord") {
    return "/dashboard/landlord";
  }
  if (source === "notifications") {
    return "/dashboard/notifications";
  }
  return bookingDashboardHrefForRole(input.role);
}
