"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function Nav({ email }: { email?: string | null }) {
  const router = useRouter();
  const { logout } = useAuth();

  return (
    <header className="border-b border-teal-200/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight text-teal-900">
          OCH Housing
        </Link>
        <nav className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-600">
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
          {email ? (
            <>
              <span
                className="hidden max-w-[200px] truncate text-slate-500 sm:inline"
                title={email ?? ""}
              >
                {email}
              </span>
              <Link href="/dashboard" className="hover:text-teal-700">
                Dashboard
              </Link>
              <button
                type="button"
                data-testid="nav-sign-out"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  logout();
                  router.push("/login");
                  router.refresh();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-teal-700">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-teal-600 px-3 py-1.5 text-white shadow-sm hover:bg-teal-500"
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