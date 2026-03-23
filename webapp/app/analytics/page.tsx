"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  analyzeListingFeel,
  getDailyMetrics,
  getSearchSummaryInsights,
  getWatchlistInsights,
  type DailyMetricsJson,
  type SearchSummaryItem,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";

export default function AnalyticsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [metrics, setMetrics] = useState<DailyMetricsJson | null>(null);
  const [insights, setInsights] = useState<{ watchlist_adds_30d?: number; notes?: string } | null>(null);
  const [title, setTitle] = useState("2BR near campus");
  const [description, setDescription] = useState("Quiet block, laundry in unit.");
  const [priceUsd, setPriceUsd] = useState("1200");
  const [audience, setAudience] = useState<"renter" | "landlord">("renter");
  const [feel, setFeel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchSummary, setSearchSummary] = useState<{
    items: SearchSummaryItem[];
    hint?: string;
    notification_hook?: string;
  } | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    setSub(getSubFromJwt(t));
  }, []);

  async function loadMetrics(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      setMetrics(await getDailyMetrics(date));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadInsights(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !sub) return;
    setErr(null);
    setLoading(true);
    try {
      const d = await getWatchlistInsights(token, sub);
      setInsights({ watchlist_adds_30d: d.watchlist_adds_30d, notes: d.notes });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadSearchSummary(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !sub) return;
    setErr(null);
    setLoading(true);
    try {
      const d = await getSearchSummaryInsights(token, sub);
      setSearchSummary({
        items: d.items ?? [],
        hint: d.hint,
        notification_hook: d.notification_hook,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function runFeel(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const cents = Math.round(Number(priceUsd) * 100);
      const r = await analyzeListingFeel(token, {
        title: title.trim(),
        description: description.trim(),
        price_cents: cents,
        audience,
      });
      setFeel(r.analysis_text ?? "");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      setLoading(true);
      try {
        const m = await getDailyMetrics(date);
        if (!cancelled) setMetrics(m);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl text-amber-50" data-testid="analytics-heading">
          Analytics &amp; insights
        </h1>
        <p className="mt-2 text-sm text-stone-400">
          Read-only aggregates from analytics-service. Listing “feel” uses Ollama when the cluster has{" "}
          <code className="rounded bg-stone-800 px-1">OLLAMA_BASE_URL</code>.
        </p>

        <section className="mt-8 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
          <h2 className="text-lg font-medium text-amber-100">Daily metrics</h2>
          <form onSubmit={loadMetrics} className="mt-4 flex flex-wrap items-end gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-amber-600 px-4 py-2 font-medium text-stone-950 hover:bg-amber-500 disabled:opacity-50"
            >
              Load
            </button>
          </form>
          {metrics && (
            <pre className="mt-4 overflow-x-auto rounded-md bg-stone-950 p-4 text-xs text-stone-300">
              {JSON.stringify(metrics, null, 2)}
            </pre>
          )}
        </section>

        {token && sub && (
          <section className="mt-8 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
            <h2 className="text-lg font-medium text-amber-100">Watchlist funnel (30d)</h2>
            <form onSubmit={loadInsights} className="mt-4">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md border border-stone-600 px-4 py-2 text-stone-200 hover:bg-stone-800 disabled:opacity-50"
              >
                Load my stats
              </button>
            </form>
            {insights && (
              <p className="mt-4 text-sm text-stone-300">
                Adds (30d): <strong>{insights.watchlist_adds_30d ?? 0}</strong>
                {insights.notes && <span className="block text-xs text-stone-500">{insights.notes}</span>}
              </p>
            )}
          </section>
        )}

        {token && sub && (
          <section className="mt-8 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
            <h2 className="text-lg font-medium text-amber-100">Past searches (analytics → booking read)</h2>
            <p className="mt-1 text-xs text-stone-500">
              Same rows as booking history, via analytics when <code className="rounded bg-stone-800 px-1">POSTGRES_URL_BOOKINGS</code>{" "}
              is set on analytics-service. Feeds digest / notification work later.
            </p>
            <form onSubmit={loadSearchSummary} className="mt-4">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md border border-stone-600 px-4 py-2 text-stone-200 hover:bg-stone-800 disabled:opacity-50"
              >
                Load my search summary
              </button>
            </form>
            {searchSummary && (
              <div className="mt-4 space-y-2 text-sm text-stone-300">
                {searchSummary.hint && <p className="text-xs text-amber-200/90">{searchSummary.hint}</p>}
                {searchSummary.notification_hook && (
                  <p className="text-xs text-stone-500">{searchSummary.notification_hook}</p>
                )}
                {searchSummary.items.length === 0 ? (
                  <p className="text-stone-500">No rows (or booking DB not wired).</p>
                ) : (
                  <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-xs">
                    {searchSummary.items.slice(0, 10).map((it, i) => (
                      <li key={i}>
                        {(it.query || "—") as string}{" "}
                        <span className="text-stone-500">
                          {it.created_at ? new Date(it.created_at).toLocaleString() : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        <section className="mt-8 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
          <h2 className="text-lg font-medium text-amber-100">Listing assistant (landlord / renter)</h2>
          <form data-testid="analytics-listing-feel-form" onSubmit={runFeel} className="mt-4 space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
              placeholder="Title"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
            />
            <div className="flex flex-wrap gap-4">
              <label className="text-sm">
                Price (USD)
                <input
                  type="number"
                  step="0.01"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)}
                  className="ml-2 rounded-md border border-stone-700 bg-stone-950 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={audience === "renter"}
                  onChange={() => setAudience("renter")}
                />
                Renter view
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={audience === "landlord"}
                  onChange={() => setAudience("landlord")}
                />
                Landlord view
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-amber-700/90 px-4 py-2 font-medium text-stone-950 hover:bg-amber-600 disabled:opacity-50"
            >
              Analyze
            </button>
          </form>
          {feel && (
            <div
              data-testid="analytics-feel-output"
              className="mt-4 rounded-md border border-stone-800 bg-stone-950/80 p-4 text-sm text-stone-300 whitespace-pre-wrap"
            >
              {feel}
            </div>
          )}
        </section>

        {err && <p className="mt-6 text-sm text-red-400">{err}</p>}

        <p className="mt-8 text-sm text-stone-500">
          <Link href="/dashboard" className="text-amber-400 hover:underline">
            Dashboard
          </Link>{" "}
          ·{" "}
          <Link href="/listings" className="text-amber-400 hover:underline">
            Listings
          </Link>
        </p>
      </main>
    </div>
  );
}
