/**
 * Serialize outbound Ollama HTTP from this process. Parallel `/api/generate` calls
 * (warmup + listing-feel) were overloading Colima CPU Ollama; host Metal also benefits
 * from avoiding concurrent loads on a single runner.
 */
let ollamaSerialChain: Promise<unknown> = Promise.resolve();

export function withOllamaSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = ollamaSerialChain.then(fn, fn);
  ollamaSerialChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
