import { redirect } from "next/navigation";

/** Legacy deep links: keep one MessagesWorkspace mount on /dashboard/messages (query ?thread=). */
export default function MessageThreadPage({ params }: { params: { id: string } }) {
  const id = encodeURIComponent(params.id || "");
  redirect(`/dashboard/messages?thread=${id}`);
}
