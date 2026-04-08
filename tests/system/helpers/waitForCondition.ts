/**
 * Generic async polling for cross-service / Kafka-adjacent tests.
 * Prefer observable DB or API state over fixed sleeps.
 */

export type WaitForConditionOptions<T> = {
  check: () => Promise<T | null | undefined | false>;
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
};

export async function waitForCondition<T>(options: WaitForConditionOptions<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 400;
  const description = options.description ?? "condition";
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await options.check();
    if (result !== null && result !== undefined && result !== false) {
      return result;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
}

/** Semantic alias: poll until downstream “consumption” is visible (e.g. analytics row). */
export async function waitForKafkaConsumption<T>(
  options: WaitForConditionOptions<T> & { service: string },
): Promise<T> {
  const { service, description, ...rest } = options;
  return waitForCondition({
    ...rest,
    description: description ?? `Kafka consumption / projection visible (${service})`,
  });
}
