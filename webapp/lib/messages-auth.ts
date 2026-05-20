"use client";

/** @deprecated Import from `@/lib/och-session` — kept for messages module compatibility. */
export {
  readOchSessionFromStorage as readMessagesAuthFromStorage,
  useOchSession as useMessagesAuth,
  type OchSessionSnapshot as MessagesAuthSnapshot,
  type UseOchSessionResult as UseMessagesAuthResult,
} from "./och-session";
