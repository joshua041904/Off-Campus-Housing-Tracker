/**
 * QA guards for Listing Intelligence: deterministic vs variable regimes.
 * temperature uses same semantics as env ANALYTICS_LI_V2_TEMPERATURE (0–1.5).
 */

export class AnalyticsEntropyAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsEntropyAssertionError";
  }
}

export function assertDeterminism(entropy: number, temperature: number): void {
  if (temperature <= 0 && entropy > 0.05) {
    throw new AnalyticsEntropyAssertionError(
      `Determinism violated: temperature=${temperature} but entropy=${entropy.toFixed(4)} > 0.05`,
    );
  }
}

export function assertVariability(entropy: number, temperature: number): void {
  if (temperature > 0 && entropy < 0.25) {
    throw new AnalyticsEntropyAssertionError(
      `Variability too low: temperature=${temperature} but entropy=${entropy.toFixed(4)} < 0.25`,
    );
  }
}
