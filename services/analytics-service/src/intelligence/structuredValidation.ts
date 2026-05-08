import type { ListingIntelligenceOutput } from "./types.js";

/** Throw if model JSON is missing required structural fields (prevents weak blobs). */
export function assertValidListingIntelligenceStrict(o: ListingIntelligenceOutput): void {
  if (!String(o.market_positioning ?? "").trim()) {
    throw new Error("Invalid model output: market_positioning required");
  }
  const driversOk =
    Array.isArray(o.value_drivers) && o.value_drivers.some((x) => String(x).trim().length > 0);
  if (!driversOk) {
    throw new Error("Invalid model output: value_drivers required (non-empty)");
  }
  const leverageOk =
    Array.isArray(o.negotiation_leverage) &&
    o.negotiation_leverage.some((x) => String(x).trim().length > 0);
  if (!leverageOk) {
    throw new Error("Invalid model output: negotiation_leverage required (non-empty)");
  }
  const riskOk = Array.isArray(o.risk_flags) && o.risk_flags.some((x) => String(x).trim().length > 0);
  if (!riskOk) {
    throw new Error("Invalid model output: risk_flags required (non-empty)");
  }
  const missOk =
    Array.isArray(o.missing_information) &&
    o.missing_information.some((x) => String(x).trim().length > 0);
  if (!missOk) {
    throw new Error("Invalid model output: missing_information required (non-empty)");
  }
  if (!String(o.verdict ?? "").trim()) {
    throw new Error("Invalid model output: verdict required");
  }
  if (!Number.isFinite(o.confidence_score) || o.confidence_score < 0 || o.confidence_score > 100) {
    throw new Error("Invalid model output: confidence_score must be 0-100");
  }
  if (!Number.isFinite(o.risk_severity_index) || o.risk_severity_index < 0 || o.risk_severity_index > 10) {
    throw new Error("Invalid model output: risk_severity_index must be 0-10");
  }
  if (
    !Number.isFinite(o.pricing_pressure_score) ||
    o.pricing_pressure_score < 0 ||
    o.pricing_pressure_score > 10
  ) {
    throw new Error("Invalid model output: pricing_pressure_score must be 0-10");
  }
}
