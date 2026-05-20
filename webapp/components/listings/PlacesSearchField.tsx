"use client";

import { useEffect, useRef, useState } from "react";

type LatLng = { lat: number; lng: number };

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: { fields?: string[]; types?: string[] },
          ) => {
            addListener: (event: string, fn: () => void) => void;
            getPlace: () => {
              geometry?: { location?: { lat: () => number; lng: () => number } };
              formatted_address?: string;
            };
          };
        };
      };
    };
  }
}

type PlacesSearchFieldProps = {
  value: string;
  onChange: (label: string) => void;
  onPlaceSelected: (place: LatLng | null) => void;
  disabled?: boolean;
};

let placesScriptPromise: Promise<void> | null = null;

function loadPlacesScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();
  if (placesScriptPromise) return placesScriptPromise;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return Promise.resolve();
  placesScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-och-places="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("maps script")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.dataset.ochPlaces = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("maps script load failed"));
    document.head.appendChild(s);
  });
  return placesScriptPromise;
}

export function PlacesSearchField({
  value,
  onChange,
  onPlaceSelected,
  disabled,
}: PlacesSearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  const [ready, setReady] = useState(false);

  onChangeRef.current = onChange;
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadPlacesScript();
        if (cancelled || !inputRef.current) return;
        if (!window.google?.maps?.places) {
          setReady(false);
          return;
        }
        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          fields: ["geometry", "formatted_address"],
          types: ["geocode"],
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const loc = place.geometry?.location;
          if (!loc) {
            onPlaceSelectedRef.current(null);
            return;
          }
          const lat = loc.lat();
          const lng = loc.lng();
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            onPlaceSelectedRef.current(null);
            return;
          }
          const label = (place.formatted_address || "Selected map area").slice(0, 200);
          onChangeRef.current(label);
          onPlaceSelectedRef.current({ lat, lng });
        });
        setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const keyMissing = !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

  return (
    <div className="flex flex-col gap-1 xl:col-span-2">
      <label className="text-xs font-medium text-slate-500">Search near (Google Places)</label>
      <input
        ref={inputRef}
        data-testid="listings-search-place"
        value={value}
        onChange={(e) => onChangeRef.current(e.target.value)}
        disabled={disabled || keyMissing}
        placeholder={
          keyMissing ? "Location search currently unavailable" : ready ? "Start typing an address or place..." : "Loading location search..."
        }
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {keyMissing ? <p className="text-[11px] text-slate-500">Keyword search still works while location search is unavailable.</p> : null}
    </div>
  );
}
