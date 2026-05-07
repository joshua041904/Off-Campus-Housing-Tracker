export type AnalysisMode =
  | "landlord_strategic"
  | "renter_defensive"
  | "market_quant"
  | "conversion_optimization"
  | "risk_audit";

export type AnalysisDepth = "quick" | "standard" | "deep";

/** Structured LLM output (strict JSON contract). */
export interface ListingIntelligenceOutput {
  verdict: string;
  market_positioning: string;
  /** Bullet-grade drivers (preferred over legacy pricing_signal). */
  value_drivers: string[];
  /** Legacy paragraph; kept for backward compatibility with older models. */
  pricing_signal: string;
  risk_flags: string[];
  missing_information: string[];
  /** Actionable leverage bullets (preferred over legacy negotiation_strategy). */
  negotiation_leverage: string[];
  /** Legacy paragraph. */
  negotiation_strategy: string;
  confidence_score: number;
  risk_severity_index: number;
  pricing_pressure_score: number;
}

export interface ListingIntelligenceMeta {
  /** Set on successful v2 runs for clients / observability. */
  contract_version?: "listing-intelligence.v2";
  primary_mode: AnalysisMode;
  secondary_lens: AnalysisMode;
  analysis_depth: AnalysisDepth;
  ensemble_models_used: string[];
  confidence_explanation: string;
  meta_eval_ok?: boolean;
  meta_eval_issues?: string;
  /** Dual-pass agreement heuristic when ANALYTICS_LI_DUAL_PASS=1 */
  low_consensus?: boolean;
}

/** Diagnostics for clients (_meta / intelligence_json.generation_meta). */
export interface ListingIntelligenceGenerationMeta {
  latency_ms: number;
  prompt_chars: number;
  truncated: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  token_estimate: number;
  /** Rough sum of /api/generate latencies for this request */
  ollama_calls_latency_ms_sum: number;
  low_consensus?: boolean;
}
