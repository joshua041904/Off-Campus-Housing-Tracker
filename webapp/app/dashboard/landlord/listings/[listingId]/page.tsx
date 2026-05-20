"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ListingMediaManager } from "@/components/landlord/ListingMediaManager";
import { Nav } from "@/components/Nav";
import {
  deleteMyListing,
  getListing,
  listListingRevisions,
  patchListingStatus,
  patchMyListing,
  postListingMedia,
  type ListingJson,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { prettyListingTitle } from "@/lib/listing-display";

function clipStr(v: unknown, n: number): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s || s === "null") return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** eBay-style lines for revision card (field deltas + media events). */
function revisionLinesFromChanges(ch: unknown): string[] {
  if (!ch || typeof ch !== "object") return [];
  const o = ch as Record<string, { from?: unknown; to?: unknown }>;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === "media_event") {
      const to = v.to as Record<string, unknown> | null | undefined;
      const from = v.from as Record<string, unknown> | null | undefined;
      if (to && typeof to === "object" && to.action === "added") {
        lines.push(`Added ${String(to.media_type || "media")}`);
      } else if (from && typeof from === "object" && from.action === "removed") {
        lines.push("Removed media");
      } else if (to && typeof to === "object" && to.action === "reordered") {
        lines.push("Reordered photos / media");
      } else {
        lines.push("Media updated");
      }
      continue;
    }
    if (k === "listing_event") {
      const flat = v as { action?: string; from?: unknown; to?: { action?: string } };
      const action = String(
        flat.action ?? (typeof flat.to === "object" && flat.to ? flat.to.action : "") ?? "",
      );
      if (action === "soft_deleted") {
        lines.push("Listing removed from marketplace (deleted)");
      } else if (action) {
        lines.push(`Listing event: ${action}`);
      } else {
        lines.push("Listing lifecycle update");
      }
      continue;
    }
    const label =
      k === "price_cents"
        ? "Price (USD/mo)"
        : k === "size_sqft"
          ? "Square feet"
          : k === "residence_type"
            ? "Residence type"
            : k === "display_location"
              ? "Display location"
              : k.replace(/_/g, " ");
    if (k === "price_cents") {
      const pf = Number(v.from);
      const pt = Number(v.to);
      const fromUsd = Number.isFinite(pf) ? (pf / 100).toFixed(0) : "—";
      const toUsd = Number.isFinite(pt) ? (pt / 100).toFixed(0) : "—";
      lines.push(`${label}: ${fromUsd} → ${toUsd}`);
    } else if (k === "description") {
      lines.push("Description updated");
    } else {
      lines.push(`${label}: ${clipStr(v.from, 40)} → ${clipStr(v.to, 40)}`);
    }
  }
  return lines.slice(0, 24);
}

const RESIDENCE_OPTIONS = [
  "apartment",
  "house",
  "townhouse",
  "condo",
  "studio",
  "room",
  "duplex",
  "other",
] as const;

function moneyFromCents(cents: number | undefined): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

export default function LandlordListingManagePage() {
  const params = useParams<{ listingId: string }>();
  const router = useRouter();
  const listingId = String(params?.listingId || "").trim();
  const [sessionReady, setSessionReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingJson | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [displayLocation, setDisplayLocation] = useState("");
  const [amenitiesText, setAmenitiesText] = useState("");
  const [residenceType, setResidenceType] = useState<string>("apartment");
  const [squareFeet, setSquareFeet] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateOrProvince, setStateOrProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [neighborhood, setNeighborhood] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [smokeFree, setSmokeFree] = useState(true);
  const [petFriendly, setPetFriendly] = useState(false);
  const [furnished, setFurnished] = useState(false);
  const [pricingMode, setPricingMode] = useState<"fixed" | "obo">("fixed");
  const [softHoldUntil, setSoftHoldUntil] = useState("");
  const [listingStatus, setListingStatus] = useState<string>("active");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<
    Array<{ id: string; created_at: string; editor_user_id: string; changes?: unknown }>
  >([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const myId = getSubFromJwt(token);

  const applyListingToForm = useCallback((l: ListingJson) => {
    setListing(l);
    setTitle(prettyListingTitle(l.title));
    setDescription(String(l.description || ""));
    setPrice(moneyFromCents(l.price_cents));
    setDisplayLocation(String(l.display_location || l.location || ""));
    setAmenitiesText((l.amenities || []).join(", "));
    const rt = String(l.residence_type || "apartment").toLowerCase();
    setResidenceType(RESIDENCE_OPTIONS.includes(rt as (typeof RESIDENCE_OPTIONS)[number]) ? rt : "apartment");
    const sq = l.square_feet ?? l.size_sqft;
    setSquareFeet(sq != null && Number.isFinite(Number(sq)) ? String(Math.floor(Number(sq))) : "");
    setBedrooms(l.bedrooms != null ? String(l.bedrooms) : "");
    setBathrooms(l.bathrooms != null ? String(l.bathrooms) : "");
    setAddressLine1(String(l.address_line1 || ""));
    setAddressLine2(String(l.address_line2 || ""));
    setCity(String(l.city || ""));
    setStateOrProvince(String(l.state_or_province || ""));
    setPostalCode(String(l.postal_code || ""));
    setCountry(String(l.country || "US"));
    setNeighborhood(String(l.neighborhood || ""));
    const lt = l.lease_terms;
    setEffectiveFrom(
      lt?.effective_from ? String(lt.effective_from).slice(0, 10) : new Date().toISOString().slice(0, 10),
    );
    setEffectiveUntil(lt?.effective_until ? String(lt.effective_until).slice(0, 10) : "");
    setSmokeFree(Boolean(l.smoke_free ?? true));
    setPetFriendly(Boolean(l.pet_friendly));
    setFurnished(Boolean(l.furnished));
    setPricingMode(String(l.pricing_mode || "fixed").toLowerCase() === "obo" ? "obo" : "fixed");
    if (l.soft_hold_until) {
      const d = new Date(String(l.soft_hold_until));
      setSoftHoldUntil(!Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 16) : "");
    } else {
      setSoftHoldUntil("");
    }
    setListingStatus(String(l.status || l.availability_status || "active").toLowerCase());
  }, []);

  const load = useCallback(async () => {
    if (!listingId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const l = await getListing(listingId, { token });
      applyListingToForm(l);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load listing");
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, [listingId, token, applyListingToForm]);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    setSessionReady(true);
    if (!t && typeof window !== "undefined") {
      window.location.replace("/login");
    }
  }, []);

  useEffect(() => {
    if (!token || !listingId) return;
    void load();
  }, [load, token, listingId]);

  useEffect(() => {
    if (!token || !listingId) return;
    let cancelled = false;
    listListingRevisions(token, listingId)
      .then((rows) => {
        if (cancelled) return;
        setRevisions(
          rows.map((r) => ({
            id: r.id,
            created_at: r.created_at,
            editor_user_id: r.editor_user_id,
            changes: r.changes,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setRevisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, listingId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !listingId || !listing) return;
    if (myId && listing.user_id && myId !== listing.user_id) {
      setError("You can only edit your own listings.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        setError("Enter a valid monthly price (USD).");
        return;
      }
      const price_cents = Math.round(priceNum * 100);
      const amenities = amenitiesText
        .split(/[,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const sqParsed = squareFeet.trim() ? Math.floor(Number(squareFeet)) : null;
      if (squareFeet.trim() && (!Number.isFinite(sqParsed) || (sqParsed as number) <= 0)) {
        setError("Square feet must be a positive number.");
        return;
      }
      const sq = squareFeet.trim() ? sqParsed : null;
      const updated = await patchMyListing(token, listingId, {
        title: title.trim(),
        description: description.trim(),
        price_cents,
        display_location: displayLocation.trim() || null,
        amenities,
        residence_type: residenceType,
        size_sqft: sq,
        bedrooms: bedrooms.trim() ? Math.floor(Number(bedrooms)) : null,
        bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
        address_line1: addressLine1.trim() || null,
        address_line2: addressLine2.trim() || null,
        city: city.trim() || null,
        state_or_province: stateOrProvince.trim() || null,
        postal_code: postalCode.trim() || null,
        country: country.trim() || null,
        neighborhood: neighborhood.trim() || null,
        effective_from: effectiveFrom.trim() || undefined,
        effective_until: effectiveUntil.trim() || null,
        smoke_free: smokeFree,
        pet_friendly: petFriendly,
        furnished,
        pricing_mode: pricingMode,
        soft_hold_until: softHoldUntil.trim() ? new Date(softHoldUntil).toISOString() : null,
      });
      applyListingToForm(updated);
      setNotice("Saved. Revision recorded.");
      try {
        const rows = await listListingRevisions(token, listingId);
        setRevisions(
          rows.map((r) => ({
            id: r.id,
            created_at: r.created_at,
            editor_user_id: r.editor_user_id,
            changes: r.changes,
          })),
        );
      } catch {
        /* ignore */
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onStatusChange(next: "active" | "paused" | "archived") {
    if (!token || !listingId) return;
    setStatusBusy(true);
    setError(null);
    setNotice(null);
    try {
      await patchListingStatus(token, listingId, next);
      setListingStatus(next);
      setNotice(`Status set to ${next}.`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setStatusBusy(false);
    }
  }

  async function onDeleteListing() {
    if (!token || !listingId) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteMyListing(token, listingId);
      setNotice(null);
      router.replace("/dashboard/landlord");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
      setDeleteConfirmOpen(false);
    }
  }

  async function onAttachVideo() {
    if (!token || !listingId) return;
    const u = videoUrlInput.trim();
    if (!u) {
      setError("Paste an https video URL first.");
      return;
    }
    if (!/^https:\/\//i.test(u)) {
      setError("Video URL must start with https://");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { listing: next } = await postListingMedia(token, listingId, {
        media_url: u,
        media_type: "video",
        sort_order: 999,
      });
      applyListingToForm(next);
      setVideoUrlInput("");
      setNotice("Video link attached.");
      const rows = await listListingRevisions(token, listingId);
      setRevisions(
        rows.map((r) => ({
          id: r.id,
          created_at: r.created_at,
          editor_user_id: r.editor_user_id,
          changes: r.changes,
        })),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Video attach failed");
    } finally {
      setSaving(false);
    }
  }

  if (!sessionReady || !token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50/40 text-slate-900">
        <Nav email={email} />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-slate-600">{!sessionReady ? "Loading…" : "Redirecting to sign in…"}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50/40 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-slate-600">
          <Link href="/dashboard/landlord" className="font-medium text-teal-700 hover:underline">
            ← Landlord dashboard
          </Link>
        </p>
        <h1 className="mt-4 text-2xl font-semibold">Edit listing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Full edit experience: details, availability dates, photos (multiple), optional video URL, and saved revision
          history. Street address stays off the public page.
        </p>

        {loading ? <p className="mt-6 text-sm text-slate-600">Loading…</p> : null}
        {error ? <p className="mt-6 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="mt-6 text-sm text-emerald-800">{notice}</p> : null}

        {!loading && listing ? (
          <div className="mt-6 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Listing status</h2>
              <p className="mt-1 text-xs text-slate-600">
                Active = visible to renters (when not booked out). Paused = draft / hidden. Archived removes from
                marketplace.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={["active", "paused", "archived"].includes(listingStatus) ? listingStatus : "active"}
                  disabled={statusBusy || ["flagged", "closed"].includes(listingStatus)}
                  onChange={(e) => {
                    const v = e.target.value as "active" | "paused" | "archived";
                    void onStatusChange(v);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused (draft)</option>
                  <option value="archived">Archived</option>
                </select>
                {statusBusy ? <span className="text-xs text-slate-500">Updating…</span> : null}
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold uppercase text-slate-500">Remove from marketplace</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Permanently hides this listing from search and the public page (soft delete). You can still see it in
                  your records if your account retains history.
                </p>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="mt-2 rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                >
                  Remove listing…
                </button>
              </div>
            </section>

            <ListingMediaManager
              token={token}
              listingId={listingId}
              listing={listing}
              disabled={saving}
              onListingUpdated={(next) => {
                applyListingToForm(next);
              }}
              onError={(m) => setError(m)}
              onNotice={setNotice}
            />

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Optional video (https)</h2>
              <p className="mt-1 text-xs text-slate-600">
                Paste a hosted <span className="font-medium">https://</span> video URL for third-party players; image/video <em>files</em> use the uploader above (OCH media URLs).
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                  placeholder="https://…"
                  className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onAttachVideo()}
                  className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  Attach video URL
                </button>
              </div>
            </section>

            <form onSubmit={(ev) => void onSave(ev)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Pricing mode</label>
                  <select
                    value={pricingMode}
                    onChange={(e) => setPricingMode(e.target.value === "obo" ? "obo" : "fixed")}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="fixed">Fixed monthly rent</option>
                    <option value="obo">Open to offers / best offer (OBO)</option>
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    OBO shows a public badge and encourages renters to start a conversation about price.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Soft hold until</label>
                  <input
                    type="datetime-local"
                    value={softHoldUntil}
                    onChange={(e) => setSoftHoldUntil(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    While hold is active, the listing is hidden from search and new booking requests are blocked. Clear
                    the field to lift the hold early.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Residence type</label>
                  <select
                    value={residenceType}
                    onChange={(e) => setResidenceType(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {RESIDENCE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Square feet</label>
                  <input
                    value={squareFeet}
                    onChange={(e) => setSquareFeet(e.target.value)}
                    inputMode="numeric"
                    placeholder="e.g. 950"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Bedrooms</label>
                  <input
                    value={bedrooms}
                    onChange={(e) => setBedrooms(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Bathrooms</label>
                  <input
                    value={bathrooms}
                    onChange={(e) => setBathrooms(e.target.value)}
                    inputMode="decimal"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Available from</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Available until (optional)</label>
                  <input
                    type="date"
                    value={effectiveUntil}
                    onChange={(e) => setEffectiveUntil(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-800">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={smokeFree} onChange={(e) => setSmokeFree(e.target.checked)} />
                  Smoke-free
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={petFriendly} onChange={(e) => setPetFriendly(e.target.checked)} />
                  Pet friendly
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} />
                  Furnished
                </label>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Public display location</label>
                <input
                  value={displayLocation}
                  onChange={(e) => setDisplayLocation(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Neighborhood · City, ST"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Neighborhood label (optional)</label>
                <input
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Near campus gate"
                />
              </div>
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Structured address (private)</p>
                <p className="mt-1 text-xs text-slate-500">Used for geocoding when enabled. Not shown on the public listing.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="Address line 1"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
                  />
                  <input
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Address line 2"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
                  />
                  <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input
                    value={stateOrProvince}
                    onChange={(e) => setStateOrProvince(e.target.value)}
                    placeholder="State / province"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="Postal code"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Monthly rent (USD)</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Amenities (comma-separated)</label>
                <input
                  value={amenitiesText}
                  onChange={(e) => setAmenitiesText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="wifi, laundry, parking"
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded bg-slate-100 px-2 py-1">Watchers: {Math.max(0, Math.floor(Number(listing.watch_count ?? 0)))}</span>
                <Link href={`/listings/${encodeURIComponent(listingId)}`} className="rounded bg-teal-50 px-2 py-1 font-medium text-teal-800 hover:underline">
                  Preview on marketplace
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving || !title.trim()}
                  className="rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save details"}
                </button>
                <Link
                  href="/dashboard/landlord"
                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Cancel
                </Link>
              </div>
            </form>

            {revisions.length > 0 ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-800">Revision history</h2>
                <p className="mt-1 text-xs text-slate-600">Each save or media change is recorded with field-level deltas when available.</p>
                <ul className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto">
                  {revisions.map((r) => {
                    const lines = revisionLinesFromChanges(r.changes);
                    return (
                      <li key={r.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm">
                        <p className="font-medium text-slate-900">
                          {new Date(r.created_at).toLocaleString()}
                          <span className="ml-2 text-xs font-normal text-slate-500">Editor {r.editor_user_id.slice(0, 8)}…</span>
                        </p>
                        {lines.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                            {lines.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">Saved snapshot (no field diff stored for this row).</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {deleteConfirmOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-listing-title"
          >
            <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
              <h2 id="delete-listing-title" className="text-lg font-semibold text-slate-900">
                Remove this listing?
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium">{title || "This listing"}</span> will be removed from the marketplace
                and search. This action is recorded in revision history.
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Keep listing
                </button>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => void onDeleteListing()}
                  className="rounded-md bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  {deleteBusy ? "Removing…" : "Yes, remove"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
