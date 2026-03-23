import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <header className="border-b border-amber-900/20 bg-stone-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="font-semibold tracking-tight text-amber-100">OCH Housing</span>
          <nav className="flex flex-wrap gap-3 text-sm">
            <Link href="/listings" className="text-stone-300 hover:text-amber-200">
              Listings
            </Link>
            <Link href="/mission" className="text-stone-300 hover:text-amber-200">
              Mission
            </Link>
            <Link href="/trust" className="text-stone-300 hover:text-amber-200">
              Trust
            </Link>
            <Link href="/analytics" className="text-stone-300 hover:text-amber-200">
              Analytics
            </Link>
            <Link href="/login" className="text-stone-300 hover:text-amber-200">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-amber-600/90 px-3 py-1.5 font-medium text-stone-950 hover:bg-amber-500"
            >
              Register
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-20">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-600/90">Off-campus housing tracker</p>
        <h1 className="mt-4 font-serif text-4xl leading-tight text-amber-50 sm:text-5xl">
          Built for the off-campus housing crunch.
        </h1>
        <p className="mt-6 text-lg text-stone-400">
          Students need one honest place to search, remember what they tried, and watch listings — not scattered group
          chats and scam posts. This stack ties <code className="rounded bg-stone-800 px-1 py-0.5 text-sm">listings</code>
          , <code className="rounded bg-stone-800 px-1 py-0.5 text-sm">booking</code>, and{" "}
          <code className="rounded bg-stone-800 px-1 py-0.5 text-sm">analytics</code> behind a gateway with real TLS/mTLS
          and test suites you can run locally.
        </p>
        <p className="mt-4 text-sm text-stone-500">
          <Link href="/mission" className="text-amber-400 hover:underline">
            Read the mission →
          </Link>
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/listings"
            className="rounded-md border border-amber-700/80 bg-amber-950/30 px-4 py-2.5 font-medium text-amber-100 hover:bg-amber-900/40"
          >
            Browse listings
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md bg-amber-600 px-4 py-2.5 font-medium text-stone-950 hover:bg-amber-500"
          >
            Open dashboard
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-stone-600 px-4 py-2.5 text-stone-200 hover:bg-stone-800"
          >
            Create account
          </Link>
        </div>
      </main>
    </div>
  );
}
