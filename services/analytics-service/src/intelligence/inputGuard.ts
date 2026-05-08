export type TruncateListingInputResult = {
  text: string;
  truncated: boolean;
};

/**
 * Prevent oversized listing descriptions from blowing context / latency.
 * Default cap overridable via ANALYTICS_LISTING_INPUT_MAX_CHARS.
 */
export function truncateListingInput(text: string, maxChars?: number): TruncateListingInputResult {
  const capRaw = maxChars ?? Number(process.env.ANALYTICS_LISTING_INPUT_MAX_CHARS ?? "6000");
  const max = Number.isFinite(capRaw) ? Math.min(32_000, Math.max(512, Math.floor(capRaw))) : 6000;
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `${text.slice(0, max)}\n\n[TRUNCATED]`,
    truncated: true,
  };
}

export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}
