import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function MissionPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">Why we built this</p>
        <h1 className="mt-4 font-serif text-4xl font-medium text-slate-900" data-testid="mission-heading">
          Housing shouldn&apos;t be a full-time job for students.
        </h1>
        <div className="mt-8 space-y-5 text-lg leading-relaxed text-slate-600">
          <p>
            Off-campus rent spikes, opaque listings, and scam-heavy marketplaces hit college students hardest. Many
            campuses don&apos;t run enough beds; students compete on Facebook groups and fragmented sites with no shared
            trust or history.
          </p>
          <p>
            <strong className="font-semibold text-slate-800">Off-Campus Housing Tracker</strong> is a reference platform
            for <em>transparent search</em>, <em>saved search history</em>, <em>watchlists</em>, and{" "}
            <em>trust signals</em> — backed by real services (auth, listings, booking, messaging, analytics) behind a
            gateway, with event pipelines for metrics and future notification digests.
          </p>
          <p>
            It exists to give teams a <strong className="text-slate-800">strict, testable baseline</strong>: TLS/mTLS at
            the edge, gRPC between services where it matters, and automated suites so green engineers can ship without
            guessing cluster state.
          </p>
        </div>
        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            href="/listings"
            className="rounded-lg bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-teal-600/25 hover:bg-teal-500"
          >
            Browse listings
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Dashboard (after login)
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-teal-200 bg-teal-50/80 px-5 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-100"
          >
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
