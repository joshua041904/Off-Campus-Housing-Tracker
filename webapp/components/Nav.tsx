"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function Nav({ email }: { email?: string | null }) {
  const router = useRouter();
  const { logout } = useAuth();

  return (
    <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-slate-950 transition hover:text-teal-700"
        >
          Off-Campus Housing Tracker
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-3 text-sm font-medium text-slate-600">
          <Link
            href="/listings"
            className="transition hover:text-slate-950"
          >
            Listings
          </Link>
          <Link
            href="/mission"
            className="transition hover:text-slate-950"
          >
            Mission
          </Link>
          <Link
            href="/trust"
            className="transition hover:text-slate-950"
          >
            Trust
          </Link>
          <Link
            href="/analytics"
            className="transition hover:text-slate-950"
          >
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
              <Link
                href="/dashboard"
                className="transition hover:text-slate-950"
              >
                Dashboard
              </Link>
              <button
                type="button"
                data-testid="nav-sign-out"
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
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
              <Link
                href="/login"
                className="transition hover:text-slate-950"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
