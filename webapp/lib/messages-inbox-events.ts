import type { InboxLoadReason } from "./messages-inbox-load";
import { shouldRunAuthReadyInboxLoad } from "./messages-inbox-ui";

export type InboxAuthSnapshot = {
  authReady: boolean;
  token: string | null;
  currentUserId: string | null;
};

export function onBadgesRefreshForInbox(
  auth: InboxAuthSnapshot,
  reload: (reason: InboxLoadReason) => void,
): void {
  if (!shouldRunAuthReadyInboxLoad(auth)) return;
  reload("badges-refresh");
}
