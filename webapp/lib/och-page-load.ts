/** Page-level load states for dashboard surfaces. */

export type LoadState =
  | "idle"
  | "auth-wait"
  | "initial-loading"
  | "loading"
  | "refreshing"
  | "loaded"
  | "error"
  | "rate-limited";

export type SurfaceLoadState = LoadState;

export function mergeSurfaceStates(states: SurfaceLoadState[]): SurfaceLoadState {
  if (states.some((s) => s === "rate-limited")) return "rate-limited";
  if (states.every((s) => s === "loaded" || s === "idle")) return "loaded";
  if (states.some((s) => s === "loading" || s === "auth-wait")) return "loading";
  if (states.some((s) => s === "error")) return "error";
  return "idle";
}

export function shouldShowDataEmpty(loadState: SurfaceLoadState, rowCount: number): boolean {
  return loadState === "loaded" && rowCount === 0;
}

export function shouldShowLoadingSkeleton(loadState: SurfaceLoadState, rowCount = 0): boolean {
  if (loadState === "auth-wait" || loadState === "initial-loading" || loadState === "loading") {
    return rowCount === 0;
  }
  return loadState === "refreshing" && rowCount === 0;
}

export function syncHintForState(loadState: SurfaceLoadState, rowCount = 0): string | null {
  if (loadState === "rate-limited" && rowCount === 0) return "Still syncing. Retrying…";
  if (loadState === "error" && rowCount === 0) {
    return "Could not load this section. Retry from the menu or refresh.";
  }
  return null;
}
