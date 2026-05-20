import { redirect } from "next/navigation";

export default function LandlordModerationLegacyRedirectPage() {
  redirect("/dashboard/moderation");
}
