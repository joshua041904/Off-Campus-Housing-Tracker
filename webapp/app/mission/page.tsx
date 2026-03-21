import Link from "next/link";

export default function MissionPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <header className="border-b border-amber-900/20 bg-stone-950/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-semibold text-amber-100">
            OCH Housing
          </Link>
          <nav className="flex gap-3 text-sm">
            <Link href="/listings" className="text-stone-300 hover:text-amber-200">
              Listings
            </Link>
            <Link href="/register" className="text-amber-400 hover:underline">
              Register
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-600/90">Why we built this</p>
        <h1
          className="mt-4 font-serif text-4xl text-amber-50"
          data-testid="mission-heading"
        >
          Housing shouldn&apos;t be a full-time job for students.
        </h1>
        <div className="mt-8 space-y-5 text-lg leading-relaxed text-stone-300">
          <p>
            Off-campus rent spikes, opaque listings, and scam-heavy marketplaces hit college students hardest. Many
            campuses don&apos;t run enough beds; students compete on Facebook groups and fragmented sites with no shared
            trust or history.
          </p>
          <p>
            <strong className="text-amber-100">Off-Campus Housing Tracker</strong> is a reference platform for{" "}
            <em>transparent search</em>, <em>saved search history</em>, <em>watchlists</em>, and <em>trust signals</em>{" "}
            — backed by real services (auth, listings, booking, messaging, analytics) behind a gateway, with event
            pipelines for metrics and future notification digests.
          </p>
          <p>
            It exists to give teams a <strong className="text-stone-200">strict, testable baseline</strong>: TLS/mTLS at
            the edge, gRPC between services where it matters, and automated suites so green engineers can ship without
            guessing cluster state.
          </p>
        </div>
        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/listings"
            className="rounded-md bg-amber-600 px-4 py-2.5 font-medium text-stone-950 hover:bg-amber-500"
          >
            Browse listings
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-stone-600 px-4 py-2.5 text-stone-200 hover:bg-stone-800"
          >
            Dashboard (after login)
          </Link>
          <Link href="/" className="rounded-md border border-amber-900/40 px-4 py-2.5 text-amber-200 hover:bg-amber-950/30">
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
