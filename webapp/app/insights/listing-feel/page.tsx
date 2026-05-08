import { redirect } from "next/navigation";

/** POST-only API path; bookmarks GET here — send users to the analytics UI (edge gateway does the same with 303). */
export default function InsightsListingFeelRedirectPage() {
  redirect("/analytics");
}
