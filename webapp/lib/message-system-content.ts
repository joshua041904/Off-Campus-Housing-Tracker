/** Booking/system lines in DM threads — neutral row, not sender chat bubbles. */
export function isSystemEventContent(content: string | undefined, messageType?: string): boolean {
  const mt = String(messageType || "").trim().toLowerCase();
  if (
    mt === "bookingnotice" ||
    mt === "system" ||
    mt === "booking_notice" ||
    mt === "booking_update" ||
    mt === "bookingnoticev1"
  ) {
    return true;
  }
  const s = String(content || "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low.startsWith("booking request created for listing")) return true;
  if (/^your booking (was|has been)\b/i.test(s)) return true;
  if (/^booking (confirmed|cancelled|canceled|accepted|rejected|expired)\b/i.test(s)) return true;
  if (/^(confirmed|cancelled|canceled) booking on your listing\b/i.test(s)) return true;
  return false;
}
