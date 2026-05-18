import { redirect } from "next/navigation";

export default function BookingsRedirectPage() {
  redirect("/dashboard/bookings");
}

