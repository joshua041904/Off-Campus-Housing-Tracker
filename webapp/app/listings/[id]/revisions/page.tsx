"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { listPublicListingRevisions, type PublicListingRevisionRow } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function ListingRevisionsPublicPage() {
  const params = useParams<{ id: string }>();
  const listingId = String(params?.id || "");
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<PublicListingRevisionRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(getStoredEmail());
    setToken(getStoredToken());
  }, []);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const out = await listPublicListingRevisions(listingId, { token });
        if (!cancelled) {
          setRows(out.items);
          setCount(out.revision_count);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load revision history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, token]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <Link href={`/listings/${encodeURIComponent(listingId)}`} className="text-sm font-medium text-teal-700 hover:underline">
            ← Back to listing
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Revision history</h1>
        <p className="mt-2 text-sm text-slate-600">
          Public summary of edits to this listing ({count} {count === 1 ? "revision" : "revisions"}). Street address and
          other private fields are not shown.
        </p>
        {loading ? <p className="mt-8 text-sm text-slate-500">Loading…</p> : null}
        {error ? (
          <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
        ) : null}
        {!loading && !error ? (
          <ol className="mt-8 space-y-4" data-testid="public-revision-list">
            {rows.length === 0 ? (
              <li className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No revisions yet.</li>
            ) : (
              rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{formatWhen(r.created_at)}</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{r.editor_display}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {r.lines.map((line, i) => (
                      <li key={`${r.id}-${i}`}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))
            )}
          </ol>
        ) : null}
      </main>
    </div>
  );
}
