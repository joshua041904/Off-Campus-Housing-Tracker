import { redirect } from "next/navigation";

/** POST-only API path; GET navigations go to analytics UI. */
export default function InsightsHybridSearchRedirectPage() {
  redirect("/analytics");
}
