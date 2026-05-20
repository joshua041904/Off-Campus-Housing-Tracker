import { redirect } from "next/navigation";

export default function LandlordLegacyRedirectPage() {
  redirect("/dashboard/landlord");
}
