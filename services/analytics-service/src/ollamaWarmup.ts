/**
 * Best-effort Ollama warmup so first listing-feel avoids cold-load inside user-facing timeouts.
 * Controlled by ANALYTICS_OLLAMA_WARMUP_ON_BOOT (default on when OLLAMA_BASE_URL is set).
 *
 * Important: `/api/tags` does not load the model into VRAM — we await a small `/api/generate`
 * (serialized with live traffic) so the first user request is less likely to exceed quick timeouts.
 */

import { ollamaKeepAliveRequestField } from "./intelligence/ollamaKeepAlive.js";
import { withOllamaSerial } from "./ollamaClientSerial.js";

export async function warmupOllamaFromEnv(): Promise<void> {
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
  if (!base) return;

  const raw = (process.env.ANALYTICS_OLLAMA_WARMUP_ON_BOOT ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return;

  const ms = Number(process.env.ANALYTICS_OLLAMA_WARMUP_TIMEOUT_MS ?? "8000");
  const tagsTimeoutMs = Number.isFinite(ms) && ms > 500 ? Math.min(30_000, Math.floor(ms)) : 8000;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), tagsTimeoutMs);
    const res = await fetch(`${base}/api/tags`, { method: "GET", signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) {
      console.warn("[analytics] Ollama warmup /api/tags non-OK:", res.status);
    } else {
      console.log("[analytics] Ollama warmup tags ok:", base);
    }
  } catch (e) {
    console.warn("[analytics] Ollama warmup tags skipped:", e instanceof Error ? e.message : e);
  }

  const genRaw = (process.env.ANALYTICS_OLLAMA_WARMUP_GENERATE ?? "1").trim().toLowerCase();
  if (genRaw === "0" || genRaw === "false" || genRaw === "off") return;

  const genMs = Number(process.env.ANALYTICS_OLLAMA_WARMUP_GENERATE_TIMEOUT_MS ?? "180000");
  const genTimeout = Number.isFinite(genMs) && genMs >= 5000 ? Math.min(240_000, Math.floor(genMs)) : 180_000;
  const model = (process.env.OLLAMA_MODEL || "llama3.2:1b").trim() || "llama3.2:1b";

  try {
    await withOllamaSerial(async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), genTimeout);
      try {
        const res = await fetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            model,
            prompt:
              "You are a warmup ping. Reply with exactly one word: OK. Do not add punctuation or other words.",
            stream: false,
            keep_alive: ollamaKeepAliveRequestField(),
            /** Match listing-feel quick KV shape so cold first-token cost is paid at boot, not on first user prompt. */
            options: { num_predict: 96, num_ctx: 1536, temperature: 0 },
          }),
        });
        if (!res.ok) {
          console.warn("[analytics] Ollama warmup /api/generate non-OK:", res.status);
          return;
        }
        console.log("[analytics] Ollama warmup generate ok:", model);
      } finally {
        clearTimeout(t);
      }
    });
  } catch (e) {
    console.warn("[analytics] Ollama warmup generate skipped:", e instanceof Error ? e.message : e);
  }
}
