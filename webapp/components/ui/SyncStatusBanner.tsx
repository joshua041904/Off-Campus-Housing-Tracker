"use client";

import type { SurfaceLoadState } from "@/lib/och-page-load";
import { syncHintForState } from "@/lib/och-page-load";

type SyncStatusBannerProps = {
  state: SurfaceLoadState;
  rowCount?: number;
  onRetry?: () => void;
  className?: string;
  "data-testid"?: string;
};

export function SyncStatusBanner({
  state,
  rowCount = 0,
  onRetry,
  className = "",
  "data-testid": testId,
}: SyncStatusBannerProps) {
  const hint = syncHintForState(state, rowCount);
  if (!hint) return null;
  return (
    <div
      className={`mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}
      data-testid={testId ?? "sync-status-banner"}
      role="status"
    >
      <span>{hint}</span>
      {onRetry && state === "error" ? (
        <button
          type="button"
          className="ml-2 font-medium text-teal-800 underline"
          onClick={() => onRetry()}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
