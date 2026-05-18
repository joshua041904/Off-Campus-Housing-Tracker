"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  createListing,
  mediaUploadTokenized,
  postListingMedia,
  type ListingJson,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { isAcceptedListingImageUploadUrl } from "@/lib/listing-media-url";

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

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LandlordCreateListingPage() {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [residenceType, setResidenceType] = useState<string>("apartment");
  const [squareFeet, setSquareFeet] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [displayLocation, setDisplayLocation] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateOrProvince, setStateOrProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [amenitiesText, setAmenitiesText] = useState("");
  const [smokeFree, setSmokeFree] = useState(true);
  const [petFriendly, setPetFriendly] = useState(false);
  const [furnished, setFurnished] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayYmd());
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setEmail(getStoredEmail());
    setToken(t);
    setSessionReady(true);
    if (!t && typeof window !== "undefined") {
      window.location.replace("/login");
    }
  }, []);

  async function onPickImages(files: FileList | null) {
    if (!token || !files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const next: string[] = [...imageUrls];
      for (const f of Array.from(files)) {
        const { url } = await mediaUploadTokenized(token, f);
        if (isAcceptedListingImageUploadUrl(url)) next.push(url);
      }
      if (next.length === 0) {
        setError("Upload did not return a usable image URL (https or OCH /api/media/... path).");
        return;
      }
      setImageUrls(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  function validateForm(): string | null {
    if (!title.trim()) return "Title is required.";
    if (!description.trim()) return "Description is required.";
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return "Enter a valid monthly rent (USD).";
    const sq = squareFeet.trim() ? Math.floor(Number(squareFeet)) : NaN;
    if (squareFeet.trim() && (!Number.isFinite(sq) || sq <= 0)) return "Square feet must be a positive number.";
    if (!addressLine1.trim()) return "Address line 1 is required.";
    if (!city.trim()) return "City is required.";
    if (!stateOrProvince.trim()) return "State / province is required.";
    if (!country.trim()) return "Country is required.";
    if (!displayLocation.trim()) return "Public display location is required (e.g. neighborhood · city).";
    if (imageUrls.length < 1) return "Upload at least one listing photo.";
    const br = bedrooms.trim() ? Math.floor(Number(bedrooms)) : null;
    if (bedrooms.trim() && (br == null || br < 0)) return "Bedrooms must be a non-negative number.";
    const ba = bathrooms.trim() ? Number(bathrooms) : null;
    if (bathrooms.trim() && (ba == null || !Number.isFinite(ba) || ba <= 0)) return "Bathrooms must be a positive number.";
    if (videoUrl.trim() && !/^https:\/\//i.test(videoUrl.trim())) return "Video URL must be https.";
    return null;
  }

  async function submit(initial_status: "active" | "paused") {
    if (!token) return;
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const priceNum = Number(price);
      const price_cents = Math.round(priceNum * 100);
      const amenities = amenitiesText
        .split(/[,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const sqParsed = squareFeet.trim() ? Math.floor(Number(squareFeet)) : null;
      const created = (await createListing(token, {
        title: title.trim(),
        description: description.trim(),
        price_cents,
        effective_from: effectiveFrom.trim(),
        effective_until: effectiveUntil.trim() || undefined,
        initial_status,
        amenities,
        smoke_free: smokeFree,
        pet_friendly: petFriendly,
        furnished,
        residence_type: residenceType,
        size_sqft: sqParsed,
        bedrooms: bedrooms.trim() ? Math.floor(Number(bedrooms)) : null,
        bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
        address_line1: addressLine1.trim(),
        address_line2: addressLine2.trim() || null,
        city: city.trim(),
        state_or_province: stateOrProvince.trim(),
        postal_code: postalCode.trim() || null,
        country: country.trim(),
        neighborhood: neighborhood.trim() || null,
        display_location: displayLocation.trim(),
        images: imageUrls,
      })) as ListingJson;
      const id = String(created.id || "");
      if (videoUrl.trim()) {
        await postListingMedia(token, id, {
          media_url: videoUrl.trim(),
          media_type: "video",
          sort_order: 100,
        });
      }
      setNotice(initial_status === "paused" ? "Draft saved." : "Listing published.");
      router.push(`/dashboard/landlord/listings/${encodeURIComponent(id)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Create failed");
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
        <h1 className="mt-4 text-2xl font-semibold">Create listing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add full details, upload photos, then publish to the marketplace or save as a draft (paused). Exact street address
          stays private; renters see the public location line.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="mt-4 text-sm text-emerald-800">{notice}</p> : null}

        <form
          className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
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
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Monthly rent (USD)</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Public display location</label>
            <input
              value={displayLocation}
              onChange={(e) => setDisplayLocation(e.target.value)}
              placeholder="Neighborhood · City, ST"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Neighborhood label (optional)</label>
            <input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Structured address (private)</p>
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
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Amenities (comma-separated)</label>
            <input
              value={amenitiesText}
              onChange={(e) => setAmenitiesText(e.target.value)}
              placeholder="wifi, laundry, parking"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={smokeFree} onChange={(e) => setSmokeFree(e.target.checked)} />
              Smoke-free
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={petFriendly} onChange={(e) => setPetFriendly(e.target.checked)} />
              Pet friendly
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} />
              Furnished
            </label>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Photos (https via upload)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading || saving}
              onChange={(e) => void onPickImages(e.target.files)}
              className="mt-1 block w-full text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">{imageUrls.length} image URL(s) ready.</p>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Video URL (optional, https)</label>
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void submit("paused")}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void submit("active")}
              className="rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? "Publishing…" : "Publish listing"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
