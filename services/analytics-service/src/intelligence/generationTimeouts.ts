/**
 * @deprecated Prefer `getOllamaGenerateTimeoutMs` from `./ollamaTimeoutBudget.js`.
 * `computeEffectiveOllamaTimeoutMs(requestedMs)` ignores `requestedMs`; timeout is env-driven only.
 */
import { getOllamaGenerateTimeoutMs } from "./ollamaTimeoutBudget.js";

export { getOllamaGenerateTimeoutMs } from "./ollamaTimeoutBudget.js";

export function computeEffectiveOllamaTimeoutMs(_requestedMs: number): number {
  return getOllamaGenerateTimeoutMs();
}
