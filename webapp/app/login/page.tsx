"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginUser } from "@/lib/api";
import { setStoredEmail, setStoredToken } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";

export default function LoginPage() {
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
      const data = await loginUser(email, password);
      if (!data.token) throw new Error("No token returned");
      setStoredToken(data.token);
      setStoredEmail(email.trim());
      router.push("/dashboard");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <Nav />
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-serif text-3xl text-amber-50">Log in</h1>
        <p className="mt-2 text-sm text-stone-400">Use your api-gateway auth account (JWT).</p>
        <form data-testid="login-form" onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label className="block text-sm text-stone-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-stone-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2"
              required
            />
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-amber-600 py-2 font-medium text-stone-950 hover:bg-amber-500 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-stone-500">
          No account?{" "}
          <Link href="/register" className="text-amber-400 hover:underline">
            Register
          </Link>
        </p>
      </main>
    </div>
  );
}
