/**
 * Best-effort Ollama warmup so first listing-feel avoids cold-load inside user-facing timeout.
 * Controlled by ANALYTICS_OLLAMA_WARMUP_ON_BOOT (default on when OLLAMA_BASE_URL is set).
 */

export async function warmupOllamaFromEnv(): Promise<void> {
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return;

  const raw = (process.env.ANALYTICS_OLLAMA_WARMUP_ON_BOOT ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return;

  const ms = Number(process.env.ANALYTICS_OLLAMA_WARMUP_TIMEOUT_MS ?? "8000");
  const timeoutMs = Number.isFinite(ms) && ms > 500 ? Math.min(30_000, Math.floor(ms)) : 8000;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${base}/api/tags`, { method: "GET", signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) {
      console.warn("[analytics] Ollama warmup /api/tags non-OK:", res.status);
      return;
    }
    console.log("[analytics] Ollama warmup ok:", base);
  } catch (e) {
    console.warn("[analytics] Ollama warmup skipped:", e instanceof Error ? e.message : e);
  }
}
