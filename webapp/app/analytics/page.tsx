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
    return () => { cancelled = true; };
  }, [date]);

  return (
    <div data-testid="analytics-page" className="min-h-screen bg-gradient-to-br from-[#f8faf8] via-[#fcfcfb] to-[#eefaf6] text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">

        <div className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">Analytics</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950" data-testid="analytics-heading">
            Analytics &amp; insights
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
            Read-only aggregates from analytics-service. Listing &ldquo;feel&rdquo; uses Ollama when the cluster has{" "}
            <code className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              OLLAMA_BASE_URL
            </code>
            .
          </p>
        </div>

        <div className="space-y-6">

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Daily metrics</h2>
            <p className="mt-1 text-xs text-slate-500">Load aggregated metrics for a specific date.</p>
            <form onSubmit={loadMetrics} className="mt-4 flex flex-wrap items-end gap-3">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600 disabled:opacity-50"
              >
                Load
              </button>
            </form>
            {metrics && (
              <pre className="mt-4 overflow-x-auto rounded-[1.25rem] border border-slate-200 bg-slate-900 p-4 text-xs leading-relaxed text-teal-100">
                {JSON.stringify(metrics, null, 2)}
              </pre>
            )}
          </section>

          {token && sub && (
            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">Watchlist funnel (30d)</h2>
              <p className="mt-1 text-xs text-slate-500">Your watchlist activity over the last 30 days.</p>
              <form onSubmit={loadInsights} className="mt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Load my stats
                </button>
              </form>
              {insights && (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm text-slate-700">
                    Adds (30d):{" "}
                    <strong className="text-slate-950">{insights.watchlist_adds_30d ?? 0}</strong>
                  </p>
                  {insights.notes && (
                    <p className="mt-1 text-xs text-slate-500">{insights.notes}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {token && sub && (
            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">Past searches</h2>
              <p className="mt-1 text-xs text-slate-500">
                Same rows as booking history, via analytics when{" "}
                <code className="rounded border border-slate-200 bg-slate-100 px-1 text-slate-700">
                  POSTGRES_URL_BOOKINGS
                </code>{" "}
                is set on analytics-service.
              </p>
              <form onSubmit={loadSearchSummary} className="mt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Load my search summary
                </button>
              </form>
              {searchSummary && (
                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {searchSummary.hint && (
                    <p className="text-xs font-semibold text-teal-700">{searchSummary.hint}</p>
                  )}
                  {searchSummary.notification_hook && (
                    <p className="text-xs text-slate-400">{searchSummary.notification_hook}</p>
                  )}
                  {searchSummary.items.length === 0 ? (
                    <p className="text-xs text-slate-400">No rows (or booking DB not wired).</p>
                  ) : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                      {searchSummary.items.slice(0, 10).map((it, i) => (
                        <li key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <span>{(it.query || "—") as string}</span>
                          <span className="text-slate-400">
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

          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Listing assistant</h2>
            <p className="mt-1 text-xs text-slate-500">
              Analyze a listing from a landlord or renter perspective using Ollama.
            </p>
            <form data-testid="analytics-listing-feel-form" onSubmit={runFeel} className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                placeholder="Title"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  Price (USD)
                  <input
                    type="number"
                    step="0.01"
                    value={priceUsd}
                    onChange={(e) => setPriceUsd(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    data-testid="analytics-audience-renter"
                    type="radio"
                    checked={audience === "renter"}
                    onChange={() => setAudience("renter")}
                    className="accent-teal-700"
                  />
                  Renter view
                </label>
                <label className="flex items-center gap-2">
                  <input
                    data-testid="analytics-audience-landlord"
                    type="radio"
                    checked={audience === "landlord"}
                    onChange={() => setAudience("landlord")}
                    className="accent-teal-700"
                  />
                  Landlord view
                </label>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600 disabled:opacity-50"
              >
                Analyze
              </button>
            </form>
            {feel && (
              <div
                data-testid="analytics-feel-output"
                className="mt-4 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap"
              >
                {feel}
              </div>
            )}
          </section>

        </div>

        {err && (
          <p className="mt-6 text-sm text-red-600">{err}</p>
        )}

        <div className="mt-8 flex gap-4 text-sm">
          <Link href="/dashboard" className="font-medium text-teal-700 hover:underline">
            Dashboard
          </Link>
          <Link href="/listings" className="font-medium text-teal-700 hover:underline">
            Listings
          </Link>
        </div>
      </main>
    </div>
  );
}