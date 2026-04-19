import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8faf8] via-[#fcfcfb] to-[#eefaf6] text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="font-semibold tracking-[0.08em] text-slate-900"
          >
            Off-Campus Housing Tracker
          </Link>

          <nav className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-600">
            <Link
              href="/listings"
              className="transition hover:text-teal-700"
            >
              Listings
            </Link>
            <Link
              href="/mission"
              className="transition hover:text-teal-700"
            >
              Mission
            </Link>
            <Link
              href="/trust"
              className="transition hover:text-teal-700"
            >
              Trust
            </Link>
            <Link
              href="/analytics"
              className="transition hover:text-teal-700"
            >
              Analytics
            </Link>
            <Link
              href="/login"
              className="transition hover:text-slate-900"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-teal-700 px-4 py-2 text-white shadow-sm transition hover:bg-teal-600"
            >
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
              Off-campus housing tracker
            </p>

            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl md:text-6xl">
              Find housing with more clarity, less chaos, and better trust
              signals.
            </h1>

            <p className="mt-6 mx-auto max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              Search listings, compare options, and explore off-campus housing
              through a cleaner, more reliable student-focused experience.
            </p>

            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/listings"
                className="rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600"
              >
                Browse listings
              </Link>
              <Link
                href="/register"
                className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Create account
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-transparent px-2 py-3 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
              >
                Go to dashboard
              </Link>
            </div>

            <p className="mt-8 text-sm text-slate-500 text-center">
              <Link
                href="/mission"
                className="font-medium text-teal-700 hover:underline"
              >
                Learn more about the project →
              </Link>
            </p>
          </div>
        </section>

        <section className="border-t border-slate-200/70 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                How it works
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Find housing in three simple steps
              </h2>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <div className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                  1
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-900">
                  Search
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Find options that match your budget and preferences.
                </p>
              </div>

              <div className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                  2
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-900">
                  Compare
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  See your best matches side-by-side to choose confidently.
                </p>
              </div>

              <div className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                  3
                </div>
                <h3 className="mt-4 text-xl font-semibold text-slate-900">
                  Act
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Contact landlords and book your housing.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200/70 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
              Technical foundation
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Built on a distributed backend system
            </h2>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
              This platform is backed by multiple services working together
              through a central gateway, keeping data ownership, routing, and
              system behavior structured and predictable.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">
                  Gateway layer
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Caddy terminates HTTPS (HTTP/2 + HTTP/3). Traffic reaches the
                  API gateway, which fans out to gRPC and HTTP backends with
                  strict TLS/mTLS inside the cluster.
                </p>
              </div>
              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">
                  Core services
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Listings, booking, messaging, trust, analytics, and media each
                  own their contracts. Events flow to Kafka where needed; the
                  webapp only sees stable HTTP APIs on one hostname.
                </p>
              </div>
              <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">
                  Data ownership
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  One Postgres per domain (auth, listings, bookings, …).
                  Listings store geo coordinates and structured amenities for
                  maps and filters; nothing bypasses the gateway from the
                  browser.
                </p>
              </div>
            </div>
            <pre
              className="mt-10 overflow-x-auto rounded-[1.75rem] border border-slate-200 bg-[#0f172a] p-5 text-left text-xs leading-relaxed text-teal-100 shadow-sm"
              aria-label="ASCII architecture diagram"
            >
              {`   Browser (Next.js)
        |
        v
   +---------+     +----------+     +---------------+
   |  Caddy  | --> | HAProxy  | --> | api-gateway   |
   |  :443   |     | (opt.)   |     | HTTP + gRPC   |
   +---------+     +----------+     +-------+-------+
                                            |
              +-----------+-----------+-----+-----+-----------+
              |           |           |           |           |
              v           v           v           v           v
        auth-svc    listings-svc  booking-svc  messaging   analytics ...
              |           |           |
              v           v           v
           Postgres    Postgres    Postgres   (one DB per service)`}
            </pre>
          </div>
        </section>
      </main>
    </div>
  );
}
