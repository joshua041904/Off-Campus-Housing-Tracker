import { redirect } from "next/navigation";

export default function LegacyPostDetailRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/community/${encodeURIComponent(params.id)}`);
}
