import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <header className="border-b border-teal-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-semibold tracking-tight text-teal-900">OCH Housing</span>
          <nav className="flex flex-wrap gap-3 text-sm font-medium text-slate-600">
            <Link href="/listings" className="hover:text-teal-700">
              Listings
            </Link>
            <Link href="/mission" className="hover:text-teal-700">
              Mission
            </Link>
            <Link href="/trust" className="hover:text-teal-700">
              Trust
            </Link>
            <Link href="/analytics" className="hover:text-teal-700">
              Analytics
            </Link>
            <Link href="/login" className="hover:text-teal-700">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-teal-600 px-3 py-1.5 text-white shadow-sm hover:bg-teal-500"
            >
              Register
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">Off-campus housing tracker</p>
          <h1 className="mt-4 font-serif text-4xl font-medium leading-tight text-slate-900 sm:text-5xl md:text-6xl">
            One place to search, save, and trust what you find.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600 sm:text-xl">
            Built for students navigating noisy marketplaces and group chats. The webapp sits on a{" "}
            <strong className="font-semibold text-slate-800">strict edge</strong> (TLS) and talks to real services —
            auth, listings, booking, messaging, analytics — so flows you run in the browser match what we verify in
            automated suites.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
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
              Dashboard
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-teal-200 bg-teal-50/80 px-5 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-100"
            >
              Create account
            </Link>
          </div>
          <p className="mt-8 text-sm text-slate-500">
            <Link href="/mission" className="font-medium text-teal-700 hover:underline">
              Why we built this →
            </Link>
          </p>
        </section>

        <section className="border-t border-slate-200/80 bg-white/60 py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="font-serif text-2xl font-medium text-slate-900 sm:text-3xl">Architecture in one glance</h2>
            <p className="mt-3 max-w-3xl text-slate-600">
              Justification: separating the browser, edge, gateway, and databases keeps TLS termination, routing, and
              data ownership explicit. You can load-test the gateway, rotate certs at Caddy, and still reason about each
              service’s Postgres instance independently.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">Edge &amp; gateway</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Caddy terminates HTTPS (HTTP/2 + HTTP/3). Traffic reaches the API gateway, which fans out to gRPC and
                  HTTP backends with strict TLS/mTLS inside the cluster.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">Services</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Listings, booking, messaging, trust, analytics, and media each own their contracts. Events flow to
                  Kafka where needed; the webapp only sees stable HTTP APIs on one hostname.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-teal-700">Data</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  One Postgres per domain (auth, listings, bookings, …). Listings store geo coordinates and structured
                  amenities for maps and filters; nothing bypasses the gateway from the browser.
                </p>
              </div>
            </div>
            <pre
              className="mt-10 overflow-x-auto rounded-xl border border-slate-200 bg-slate-900 p-4 text-left text-xs leading-relaxed text-teal-100/95"
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
