/** Dev-only structured logs for Messages inbox load (no token values). */
export function messagesDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MESSAGES_DEBUG === "1";
}

export function logMessagesDebug(event: string, detail?: Record<string, unknown>): void {
  if (!messagesDebugEnabled()) return;
  console.info("[messages-inbox]", event, detail ?? {});
}
