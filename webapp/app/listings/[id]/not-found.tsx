import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function ListingNotFound() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.14),_transparent_28%),linear-gradient(180deg,_#f8fffd_0%,_#ffffff_34%,_#f8fafc_100%)] text-slate-900">
      <Nav />

      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
          Listing not found
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
          We could not find that listing.
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The listing may have been removed, or the link may be incorrect.
        </p>
        <Link
          href="/listings"
          className="mt-8 rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600"
        >
          Back to listings
        </Link>
      </main>
    </div>
  );
}
