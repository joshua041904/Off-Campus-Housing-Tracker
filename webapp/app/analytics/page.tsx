"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  analyzeListingFeel,
  formatListingFeelModelForUi,
  getDailyMetrics,
  getSearchSummaryInsights,
  getWatchlistInsights,
  type DailyMetricsJson,
  type SearchSummaryItem,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";

function MetricsSummary({ m }: { m: DailyMetricsJson }) {
  const rows: { label: string; value: string | number }[] = [
    { label: "New users", value: m.new_users ?? "—" },
    { label: "New listings", value: m.new_listings ?? "—" },
    { label: "New bookings", value: m.new_bookings ?? "—" },
    { label: "Completed bookings", value: m.completed_bookings ?? "—" },
    { label: "Messages sent", value: m.messages_sent ?? "—" },
    { label: "Listings flagged", value: m.listings_flagged ?? "—" },
  ];
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AnalyticsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [metrics, setMetrics] = useState<DailyMetricsJson | null>(null);
  const [insights, setInsights] = useState<{
    watchlist_adds_30d?: number;
    watchlist_removes_30d?: number;
  } | null>(null);
  const [title, setTitle] = useState("2BR near campus");
  const [description, setDescription] = useState("Quiet block, laundry in unit.");
  const [priceUsd, setPriceUsd] = useState("1200");
  const [audience, setAudience] = useState<"renter" | "landlord">("renter");
  const [feel, setFeel] = useState<string | null>(null);
  const [feelMeta, setFeelMeta] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [feelLoading, setFeelLoading] = useState(false);
  const [searchSummary, setSearchSummary] = useState<{
    items: SearchSummaryItem[];
    search_history_available?: boolean;
  } | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    setSub(getSubFromJwt(t));
  }, []);

  const loadInsightsBundle = useCallback(async () => {
    const t = getStoredToken();
    const u = getSubFromJwt(t);
    if (!t || !u) return;
    setErr(null);
    setInsightsLoading(true);
    try {
      const [w, s] = await Promise.all([
        getWatchlistInsights(t, u),
        getSearchSummaryInsights(t, u),
      ]);
      setInsights({
        watchlist_adds_30d: w.watchlist_adds_30d,
        watchlist_removes_30d: w.watchlist_removes_30d,
      });
      setSearchSummary({
        items: s.items ?? [],
        search_history_available: s.search_history_available !== false,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load your insights.");
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token || !sub) return;
    void loadInsightsBundle();
  }, [token, sub, loadInsightsBundle]);

  async function loadMetrics(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setMetricsLoading(true);
    try {
      setMetrics(await getDailyMetrics(date));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load daily metrics.");
    } finally {
      setMetricsLoading(false);
    }
  }

  async function runFeel(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setFeelLoading(true);
    setFeel(null);
    setFeelMeta(null);
    try {
      const cents = Math.round(Number(priceUsd) * 100);
      const t = getStoredToken();
      const r = await analyzeListingFeel(
        t,
        {
          title: title.trim(),
          description: description.trim(),
          price_cents: cents,
          audience,
          analysis_depth: "quick",
        },
        /** Align with analytics quick Ollama budget (~120s in k8s) so the browser does not abort first. */
        { timeoutMs: 130_000 },
      );
      if (r.error) {
        setErr(r.error);
        return;
      }
      const raw = r.analysis_text;
      setFeel(
        typeof raw === "string"
          ? raw
          : raw !== undefined && raw !== null
            ? JSON.stringify(raw, null, 2)
            : "",
      );
      const timing = r.listing_feel_timing;
      const modelLabel = formatListingFeelModelForUi(r.model_used);
      if (timing?.server_ms != null || modelLabel) {
        const bits = [
          modelLabel ? `Model: ${modelLabel}` : null,
          timing?.server_ms != null ? `Server: ${Math.round(timing.server_ms)} ms` : null,
        ].filter(Boolean);
        setFeelMeta(bits.join(" · "));
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Listing assistant failed.");
    } finally {
      setFeelLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      setMetricsLoading(true);
      try {
        const m = await getDailyMetrics(date);
        if (!cancelled) setMetrics(m);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load daily metrics.");
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900" data-testid="analytics-heading">
          Analytics &amp; insights
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Platform activity for the selected day, plus your saved-search and watchlist trends when you are signed in.
          Listing assistant runs a quick pass so the page stays responsive.
        </p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Daily metrics</h2>
          <form onSubmit={loadMetrics} className="mt-4 flex flex-wrap items-end gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
            />
            <button
              type="submit"
              disabled={metricsLoading}
              className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Refresh
            </button>
          </form>
          {metricsLoading && !metrics ? (
            <p className="mt-4 text-sm text-slate-500">Loading metrics…</p>
          ) : null}
          {metrics && <MetricsSummary m={metrics} />}
        </section>

        {token && sub && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-slate-900">Your activity</h2>
              <button
                type="button"
                disabled={insightsLoading}
                onClick={() => void loadInsightsBundle()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {insightsLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Watchlist adds/removes in the last 30 days, and your recent saved searches when that data is available.
            </p>
            {insights && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">Watchlist adds (30d)</p>
                  <p className="text-xl font-semibold text-slate-900">{insights.watchlist_adds_30d ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">Watchlist removes (30d)</p>
                  <p className="text-xl font-semibold text-slate-900">{insights.watchlist_removes_30d ?? 0}</p>
                </div>
              </div>
            )}
            {searchSummary && (
              <div className="mt-6 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-800">Recent saved searches</h3>
                {searchSummary.search_history_available === false ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Saved search history is not available for your account right now. Your watchlist totals above still
                    reflect recent activity.
                  </p>
                ) : searchSummary.items.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No saved searches yet — run a search and save it from the listings page to build history here.</p>
                ) : (
                  <ul className="mt-2 max-h-52 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700">
                    {searchSummary.items.slice(0, 12).map((it, i) => (
                      <li key={i}>
                        {(it.query || "Saved search") as string}{" "}
                        <span className="text-slate-500">
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

        <section className="mt-8 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Listing assistant</h2>
          <p className="mt-1 text-sm text-slate-600">
            Short, practical read on how this listing reads to renters or landlords. Uses the quick analysis mode so
            results return faster.
          </p>
          <form data-testid="analytics-listing-feel-form" onSubmit={runFeel} className="mt-4 space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
              placeholder="Title"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
            />
            <div className="flex flex-wrap gap-4 text-slate-700">
              <label className="text-sm">
                Price (USD)
                <input
                  type="number"
                  step="0.01"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)}
                  className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 shadow-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  data-testid="analytics-audience-renter"
                  type="radio"
                  checked={audience === "renter"}
                  onChange={() => setAudience("renter")}
                />
                Renter view
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  data-testid="analytics-audience-landlord"
                  type="radio"
                  checked={audience === "landlord"}
                  onChange={() => setAudience("landlord")}
                />
                Landlord view
              </label>
            </div>
            <button
              type="submit"
              disabled={feelLoading}
              className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {feelLoading ? "Analyzing…" : "Analyze"}
            </button>
          </form>
          {feelMeta ? <p className="mt-2 text-xs text-slate-500">{feelMeta}</p> : null}
          {feel ? (
            <div
              data-testid="analytics-feel-output"
              className="mt-4 rounded-md border border-teal-100 bg-teal-50/60 p-4 text-sm text-slate-800 whitespace-pre-wrap"
            >
              {feel}
            </div>
          ) : null}
        </section>

        {err && <p className="mt-6 text-sm text-red-600">{err}</p>}

        <p className="mt-8 text-sm text-slate-600">
          <Link href="/dashboard" className="font-medium text-teal-700 hover:underline">
            Dashboard
          </Link>{" "}
          ·{" "}
          <Link href="/listings" className="font-medium text-teal-700 hover:underline">
            Listings
          </Link>
        </p>
      </main>
    </div>
  );
}
