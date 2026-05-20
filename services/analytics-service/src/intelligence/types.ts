export type AnalysisMode =
  | "landlord_strategic"
  | "renter_defensive"
  | "market_quant"
  | "conversion_optimization"
  | "risk_audit";

export type AnalysisDepth = "quick" | "standard" | "deep";

/** End-to-end phases for POST /insights/listing-feel (browser + gateway still add their own latency). */
export type ListingFeelPath =
  | "unknown"
  | "cache_hit"
  | "cache_hit_after_lock_miss"
  | "no_ollama"
  | "runtime_legacy_mode"
  | "li_v2"
  | "legacy_ollama"
  | "rule_based_fallback";

/** Populated on successful listing-feel responses for live bottleneck analysis. */
export interface ListingFeelTiming {
  path: ListingFeelPath;
  /** Wall time inside analytics `analyzeListingFeelText` pipeline (cache → lock → model). */
  server_ms: number;
  cache_hit?: boolean;
  /** Sum of Ollama /api/generate durations where applicable (LI v2 may be multiple calls). */
  ollama_sum_ms?: number;
  /** LI v2 internal wall (generate + optional passes before HTTP returns). */
  li_v2_wall_ms?: number;
  /** Legacy single-shot /api/generate round-trip only. */
  legacy_ollama_http_ms?: number;
  /** Time to normalize/slice title + description before the model call (ms). */
  prompt_build_ms?: number;
  /** Wall time for JSON stringify + cache write after model output (ms). */
  post_process_ms?: number;
  /** UTF-8 byte length of the HTTP JSON body (approximate; set at HTTP layer). */
  response_bytes_approx?: number;
  /** Best-effort hint from Ollama load metrics when available. */
  ollama_warm?: "unknown" | "likely_cold" | "likely_warm";
  prompt_chars?: number;
  truncated?: boolean;
  max_tokens?: number;
  analysis_depth?: AnalysisDepth;
  /** Resolved Ollama HTTP base URL for this request (from OLLAMA_BASE_URL). */
  ollama_base_url?: string;
  /** Model name sent to Ollama (OLLAMA_MODEL / runtime). */
  ollama_model?: string;
}

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
  /** Canary/shadow arbitration details (Phase C). */
  arbitration_mode?: "shadow" | "canary";
  arbitration_winner_model?: string;
  arbitration_canary_model?: string;
  arbitration_score_gap?: number;
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
