import { createHash, randomUUID } from "node:crypto";
import { acquireLockWithToken, releaseLockWithToken } from "@common/utils";
import { pool } from "./db.js";

const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

function contentKey(title: string, description: string, priceCents: number, audience: string): string {
  return createHash("sha256").update(`${title}|${description}|${priceCents}|${audience}`).digest("hex");
}

export async function analyzeListingFeelText(input: {
  title: string;
  description: string;
  price_cents: number;
  audience: string;
}): Promise<{ analysis_text: string; model_used: string }> {
  const audience = (input.audience || "renter").toLowerCase() === "landlord" ? "landlord" : "renter";
  const hash = contentKey(input.title, input.description, input.price_cents, audience);

  const cached = await pool.query(
    `SELECT analysis_text, model FROM analytics.listing_feel_cache WHERE content_hash = $1 AND audience = $2 ORDER BY created_at DESC LIMIT 1`,
    [hash, audience]
  );
  if (cached.rows[0]) {
    return { analysis_text: String(cached.rows[0].analysis_text), model_used: String(cached.rows[0].model) };
  }

  if (!OLLAMA_URL) {
    return {
      analysis_text:
        audience === "landlord"
          ? "LLM disabled (set OLLAMA_BASE_URL). Summarize: highlight price vs market, condition, and lease terms."
          : "LLM disabled (set OLLAMA_BASE_URL). Summarize: value, commute fit, and questions to ask the landlord.",
      model_used: "none",
    };
  }

  const lockKey = `och:listing-feel:${hash}:${audience}`;
  const token = randomUUID();
  let gotLock = await acquireLockWithToken(lockKey, token, 45_000);
  if (!gotLock) {
    await new Promise((r) => setTimeout(r, 400));
    const retry = await pool.query(
      `SELECT analysis_text, model FROM analytics.listing_feel_cache WHERE content_hash = $1 AND audience = $2 ORDER BY created_at DESC LIMIT 1`,
      [hash, audience]
    );
    if (retry.rows[0]) {
      return { analysis_text: String(retry.rows[0].analysis_text), model_used: String(retry.rows[0].model) };
    }
  }

  try {
    const prompt =
      audience === "landlord"
        ? `You help landlords. In 4-6 bullet points, comment on pricing reasonableness, presentation, and risks for: title="${input.title}", description="${input.description}", price_usd=${(input.price_cents / 100).toFixed(2)}. Be concise.`
        : `You help renters. In 4-6 bullet points, comment on value, red flags, and questions to ask for: title="${input.title}", description="${input.description}", price_usd=${(input.price_cents / 100).toFixed(2)}. Be concise.`;

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { analysis_text: `Ollama error: HTTP ${res.status}`, model_used: OLLAMA_MODEL };
    }
    const body = (await res.json()) as { response?: string };
    const text = String(body.response || "").trim() || "(empty response)";
    await pool.query(
      `INSERT INTO analytics.listing_feel_cache (content_hash, audience, model, analysis_text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_hash, audience) DO NOTHING`,
      [hash, audience, OLLAMA_MODEL, text]
    );
    return { analysis_text: text, model_used: OLLAMA_MODEL };
  } finally {
    if (gotLock) await releaseLockWithToken(lockKey, token);
  }
}
