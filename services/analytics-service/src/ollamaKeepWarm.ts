/**
 * Periodic tiny `/api/generate` while idle so Ollama runner + KV cache for the listing model
 * stay hot (paired with `keep_alive` on real traffic). Disabled when interval env is unset or < 60s.
 */

import { ollamaKeepAliveRequestField } from "./intelligence/ollamaKeepAlive.js";
import { withOllamaSerial } from "./ollamaClientSerial.js";

function ollamaBase(): string {
  return (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "").trim();
}

function ollamaModel(): string {
  return (process.env.OLLAMA_MODEL || "llama3.2:1b").trim() || "llama3.2:1b";
}

export function startOllamaKeepWarmScheduler(): (() => void) | undefined {
  const base = ollamaBase();
  if (!base) return undefined;
  const raw = (process.env.ANALYTICS_OLLAMA_KEEP_WARM_INTERVAL_MS ?? "0").trim();
  const intervalMs = Number(raw);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return undefined;

  const genMs = Number(process.env.ANALYTICS_OLLAMA_KEEP_WARM_GENERATE_TIMEOUT_MS ?? "45000");
  const genTimeout = Number.isFinite(genMs) && genMs >= 5000 ? Math.min(120_000, Math.floor(genMs)) : 45_000;

  const tick = (): void => {
    void withOllamaSerial(async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), genTimeout);
      try {
        const res = await fetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            model: ollamaModel(),
            prompt: "keep-warm ping: reply OK",
            stream: false,
            keep_alive: ollamaKeepAliveRequestField(),
            options: { num_predict: 8, num_ctx: 512, temperature: 0 },
          }),
        });
        if (!res.ok) {
          console.warn("[analytics] keep-warm generate non-OK:", res.status);
        }
      } catch (e) {
        console.warn("[analytics] keep-warm generate skipped:", e instanceof Error ? e.message : e);
      } finally {
        clearTimeout(t);
      }
    });
  };

  const id = setInterval(tick, intervalMs);
  console.log(
    `[analytics] Ollama keep-warm enabled every ${intervalMs}ms (generate cap ${genTimeout}ms, model=${ollamaModel()})`,
  );
  return () => clearInterval(id);
}
