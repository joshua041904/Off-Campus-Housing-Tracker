import { describe, expect, it } from "vitest";
import { deriveBookingCalendarViewport } from "./booking-calendar";

describe("deriveBookingCalendarViewport", () => {
  it("anchors an existing long stay on the true start month", () => {
    const out = deriveBookingCalendarViewport({
      bookingStartDate: "2026-08-15",
      bookingEndDate: "2026-12-20",
      calendarMonthOffset: 0,
      todayYmd: "2026-05-13",
    });

    expect(out.leftMonthKey).toBe("2026-08");
    expect(out.rightMonthKey).toBe("2026-12");
    expect(out.endMonthKey).toBe("2026-12");
    expect(out.endMonthVisible).toBe(true);
    expect(out.jumpToEndOffset).toBe(4);
  });

  it("uses availability start month when no dates are selected", () => {
    const out = deriveBookingCalendarViewport({
      bookingStartDate: "",
      bookingEndDate: "",
      availableFromYmd: "2026-09-08",
      calendarMonthOffset: 0,
      todayYmd: "2026-05-13",
    });

    expect(out.leftMonthKey).toBe("2026-09");
    expect(out.rightMonthKey).toBe("2026-10");
    expect(out.endMonthVisible).toBe(false);
    expect(out.jumpToEndOffset).toBe(null);
  });

  it("keeps adjacent stays visible without a jump hint", () => {
    const out = deriveBookingCalendarViewport({
      bookingStartDate: "2026-08-15",
      bookingEndDate: "2026-09-02",
      calendarMonthOffset: 0,
      todayYmd: "2026-05-13",
    });

    expect(out.leftMonthKey).toBe("2026-08");
    expect(out.rightMonthKey).toBe("2026-09");
    expect(out.endMonthVisible).toBe(true);
    expect(out.jumpToEndOffset).toBe(null);
  });
});
