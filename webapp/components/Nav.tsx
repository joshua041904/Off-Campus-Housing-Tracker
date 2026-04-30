"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function Nav({ email }: { email?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  const navLinkClass = (href: string) =>
    `transition ${
      pathname === href ? "text-teal-700" : "hover:text-slate-950"
    }`;
  const { logout } = useAuth();

  return (
    <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className={`text-base font-semibold tracking-tight transition ${
            pathname === "/"
              ? "text-teal-700"
              : "text-slate-950 hover:text-teal-700"
          }`}
        >
          Off-Campus Housing Tracker
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-3 text-sm font-medium text-slate-600">
          <Link
            href="/listings"
            className={navLinkClass("/listings")}
          >
            Listings
          </Link>
          <Link
            href="/mission"
            className={navLinkClass("/mission")}
          >
            Mission
          </Link>
          <Link
            href="/trust"
            className={navLinkClass("/trust")}
          >
            Trust
          </Link>
          <Link
            href="/analytics"
            className={navLinkClass("/analytics")}
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
                className={navLinkClass("/dashboard")}
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
                className={navLinkClass("/login")}
              >
                Log in
              </Link>
              <Link
                href="/register"
                className={`rounded-full px-4 py-2 text-sm font-semibold shadow-lg shadow-teal-700/20 transition ${
                  pathname === "/register"
                    ? "bg-teal-800 text-white"
                    : "bg-teal-700 text-white hover:bg-teal-600"
                }`}
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
