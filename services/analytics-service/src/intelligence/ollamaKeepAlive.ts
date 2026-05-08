/** HTTP `/api/generate` accepts duration strings; `-1` is invalid in JSON — use a long TTL instead. */
export function ollamaKeepAliveRequestField(): string {
  const v = (process.env.ANALYTICS_OLLAMA_KEEP_ALIVE ?? process.env.OLLAMA_KEEP_ALIVE ?? "-1").trim();
  if (!v || v === "-1") return "24h";
  return v;
}
