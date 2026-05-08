import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AnalyticsDiagnosticLine = {
  ts: string;
  listing_id?: string | null;
  mode?: string;
  primary_mode?: string;
  secondary_lens?: string;
  depth?: string;
  prompt_system_len?: number;
  prompt_user_len?: number;
  prompt_user_preview?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  ensemble?: boolean;
  model_calls?: { model: string; latency_ms: number }[];
  agreement_score?: number;
  risk_variance?: number;
  confidence_score?: number;
  fallback_used?: boolean;
  analytics_mode: "LLM" | "FALLBACK" | "NONE";
  latency_ms?: number;
  truncated?: boolean;
  token_estimate?: number;
  low_consensus?: boolean;
  error?: string | null;
};

function defaultLogPath(): string {
  return process.env.ANALYTICS_DIAGNOSTICS_LOG_PATH?.trim() || "bench_logs/analytics_diagnostics.jsonl";
}

export function appendAnalyticsDiagnostic(row: AnalyticsDiagnosticLine): void {
  const path = defaultLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.warn("[analytics-diagnostics] append failed", (e as Error)?.message || e);
  }
}
