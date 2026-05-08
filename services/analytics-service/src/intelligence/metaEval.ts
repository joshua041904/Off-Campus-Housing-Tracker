import type { ListingIntelligenceOutput } from "./types.js";

export async function runMetaEval(params: {
  baseUrl: string;
  model: string;
  output: ListingIntelligenceOutput;
  timeoutMs: number;
  fetchOnce: typeof fetch;
}): Promise<{ ok: boolean; issues: string } | null> {
  if (process.env.ANALYTICS_META_EVAL !== "1") return null;
  const system =
    "You validate structured rental listing intelligence. Reply with STRICT JSON only: {\"ok\":boolean,\"issues\":string}. Max 60 words in issues.";
  const prompt = `Check for internal contradictions, empty critical fields, or duplicated ideas.\n${JSON.stringify(params.output).slice(0, 4000)}`;
  try {
    const res = await params.fetchOnce(`${params.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        format: "json",
        stream: false,
        system,
        prompt,
        options: { num_predict: 120, temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
      }),
      signal: AbortSignal.timeout(Math.min(params.timeoutMs, 45_000)),
    });
    const raw = await res.text();
    const outer = JSON.parse(raw) as { response?: string };
    const inner = typeof outer.response === "string" ? JSON.parse(outer.response) : outer.response;
    const o = inner as { ok?: unknown; issues?: unknown };
    return {
      ok: Boolean(o.ok),
      issues: typeof o.issues === "string" ? o.issues : "",
    };
  } catch {
    return null;
  }
}
