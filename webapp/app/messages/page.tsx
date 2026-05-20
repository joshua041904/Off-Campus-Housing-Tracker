import { redirect } from "next/navigation";

export default function MessagesLegacyRedirectPage() {
  redirect("/dashboard/messages");
}
