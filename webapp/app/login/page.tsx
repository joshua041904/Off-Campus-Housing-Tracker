"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginUser } from "@/lib/api";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth-context";
import { mapAuthError } from "@/lib/auth-errors";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setErr(null);
    setLoading(true);
    try {
      const data = await loginUser(email, password);
      if (!data.token) throw new Error("No token returned");
      login(data.token, email);
      router.push("/dashboard");
    } catch (e: unknown) {
      setErr(mapAuthError(e, "Login failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8faf8] via-[#fcfcfb] to-[#eefaf6] text-slate-900">
      <Nav />
      <main className="mx-auto max-w-md px-4 py-16 sm:py-24">
        <div className="rounded-[2rem] border border-slate-200/80 bg-white/95 p-8 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.18)]">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Log in</h1>
          <p className="mt-2 text-sm text-slate-500">Use your api-gateway auth account (JWT).</p>
          <form data-testid="login-form" onSubmit={onSubmit} className="mt-8 space-y-4" aria-busy={loading}>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                required
              />
            </div>
            {err && (
              <p
                data-testid="login-error"
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600"
              >
                {err}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-teal-700 py-2.5 font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600 disabled:opacity-60"
            >
              {loading && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            No account?{" "}
            <Link href="/register" className="font-medium text-teal-700 hover:underline">
              Create account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
