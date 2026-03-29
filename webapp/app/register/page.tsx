"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "@/lib/api";
import { setStoredEmail, setStoredToken } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const data = await registerUser(email, password);
      if (!data.token) throw new Error("No token returned");
      setStoredToken(data.token);
      setStoredEmail(email.trim());
      router.push("/dashboard");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <Nav />
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-xl border border-slate-200 bg-white/90 p-8 shadow-sm backdrop-blur-sm">
          <h1 className="font-serif text-3xl text-slate-900">Create account</h1>
          <p className="mt-2 text-sm text-slate-600">Registers via gateway → auth-service (gRPC).</p>
          <form data-testid="register-form" onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                required
              />
            </div>
            {err && (
              <p data-testid="register-error" className="text-sm text-red-600">
                {err}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-teal-600 py-2.5 font-semibold text-white shadow-md shadow-teal-600/20 hover:bg-teal-500 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Register"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-teal-700 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
