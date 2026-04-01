/**
 * Poll until `isReady()` returns true or `timeoutMs` elapses.
 * Use after publishing user.account.deleted to wait for consumer side-effects (DB rows, cache).
 *
 * @param timeoutMs — max wait (default 5000)
 * @param pollMs — delay between polls (default 250)
 * @param isReady — when omitted, resolves immediately (scaffold / no-op for CI without stack)
 */
export async function waitForKafkaPropagation(
  timeoutMs = 5000,
  pollMs = 250,
  isReady?: () => Promise<boolean>,
): Promise<void> {
  const check = isReady ?? (async () => true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* retry until timeout */
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `waitForKafkaPropagation: timeout after ${timeoutMs}ms (condition never became true)`,
  );
}
