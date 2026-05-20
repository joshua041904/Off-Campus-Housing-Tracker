import { redirect } from "next/navigation";

/** Canonical public host URL → detailed reputation + reviews UI. */
export default function UserPublicProfileRedirect({ params }: { params: { userId: string } }) {
  const id = String(params?.userId || "").trim();
  redirect(`/users/${encodeURIComponent(id)}/feedback`);
}
