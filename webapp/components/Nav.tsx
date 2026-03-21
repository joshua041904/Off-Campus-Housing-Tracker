"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredToken } from "@/lib/auth-storage";

export function Nav({ email }: { email?: string | null }) {
  const router = useRouter();
  return (
    <header className="border-b border-amber-900/20 bg-stone-950/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight text-amber-100">
          OCH Housing
        </Link>
        <nav className="flex flex-wrap items-center gap-3 text-sm text-stone-300">
          <Link href="/listings" className="hover:text-amber-200">
            Listings
          </Link>
          <Link href="/mission" className="hover:text-amber-200">
            Mission
          </Link>
          <Link href="/trust" className="hover:text-amber-200">
            Trust
          </Link>
          <Link href="/analytics" className="hover:text-amber-200">
            Analytics
          </Link>
          {email ? (
            <>
              <span className="hidden sm:inline truncate max-w-[200px]" title={email ?? ""}>
                {email}
              </span>
              <Link href="/dashboard" className="hover:text-amber-200">
                Dashboard
              </Link>
              <button
                type="button"
                data-testid="nav-sign-out"
                className="rounded-md border border-stone-600 px-2 py-1 hover:bg-stone-800"
                onClick={() => {
                  clearStoredToken();
                  router.push("/login");
                  router.refresh();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-amber-200">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-amber-600/90 px-3 py-1.5 font-medium text-stone-950 hover:bg-amber-500"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
