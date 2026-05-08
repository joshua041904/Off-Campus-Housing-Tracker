import { redirect } from "next/navigation";

/** POST-only analyze endpoint; GET navigations go to analytics UI. */
export default function InsightsListingAnalyzeRedirectPage() {
  redirect("/analytics");
}
