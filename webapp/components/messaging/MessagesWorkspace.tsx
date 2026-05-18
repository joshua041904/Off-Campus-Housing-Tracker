"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMessagingGroupMember,
  archiveMessagingThread,
  createMessagingGroup,
  deleteMessagingThreadForUser,
  deleteMessagingMessage,
  hideMessagingMessageForMe,
  unhideMessagingMessageForMe,
  getMessagingThreadHiddenForMe,
  getMessagingExternalContactCapabilities,
  getMessagingGroup,
  getMessagingThread,
  kickMessagingGroupMember,
  markMessagingThreadRead,
  listMessagingExternalContacts,
  deleteMessagingReaction,
  patchMessagingMessage,
  postMessagingMessage,
  postMessagingReaction,
  resolveTrustPublicUserHandle,
  searchMessagingUsers,
  submitMessagingExternalContact,
  type ExternalContactCapabilities,
  type ExternalContactHistoryRow,
  type MessagingGroupDetail,
  type MessagingMessageRow,
  type MessagingUserSearchResult,
  type MessagingThreadSummary,
} from "@/lib/api";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { useMessagesAuth } from "@/lib/messages-auth";
import { logMessagesDebug } from "@/lib/messages-debug";
import { onBadgesRefreshForInbox } from "@/lib/messages-inbox-events";
import { classifyFetchFailure } from "@/lib/och-fetch-errors";
import {
  shouldRetryBookingUpdatesOnTab,
  shouldShowBookingUpdatesLoading,
  shouldShowInboxEmpty,
  shouldShowThreadsLoading,
} from "@/lib/messages-inbox-ui";
import {
  loadBookingUpdatesForUser,
  loadMessagingThreadsForUser,
  markInboxLoadedForUser,
  shouldClearInboxForAuthChange,
  type InboxLoadReason,
} from "@/lib/messages-inbox-load";
import { prettyListingTitle, prettyMessagePreview } from "@/lib/listing-display";
import { isSystemEventContent } from "@/lib/message-system-content";
import { formatUserDisplayName } from "@/lib/user-display";
import {
  openBookingNotificationFromProjection,
  type BookingUpdateProjection,
} from "@/lib/booking-notification-projection";
import { MessageBubble } from "./MessageBubble";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_RE = /^\+?[0-9()\-\s]{7,20}$/;

type ThreadMsg = {
  id?: string;
  sender_id?: string;
  recipient_id?: string | null;
  group_id?: string | null;
  message_type?: string;
  content?: string;
  subject?: string;
  created_at?: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  recalled_at?: string | null;
  sender_username?: string;
  sender_display_name?: string | null;
  sender_avatar_url?: string | null;
  recipient_username?: string;
  recipient_display_name?: string | null;
  recipient_avatar_url?: string | null;
  reply_to_message_id?: string | null;
  reply_to_message?: {
    id?: string;
    sender_id?: string;
    content_snippet?: string;
    message_type?: string;
    created_at?: string;
    deleted?: boolean;
  } | null;
  reactions?: Array<{ emoji: string; count: number; includes_me?: boolean }>;
};

/** Group topic only — DMs omit subject (no email-style threading in UI). */
function groupThreadSubjectLine(messages: ThreadMsg[]): string {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );
  for (const m of sorted) {
    const raw = String(m.subject ?? "").trim();
    if (!raw) continue;
    const norm = raw.replace(/^re:\s*/i, "").trim();
    if (/^conversation$/i.test(norm)) continue;
    if (/^direct message$/i.test(norm)) continue;
    return raw.length > 500 ? raw.slice(0, 500) : raw;
  }
  return "";
}

function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatMessageSender(m: ThreadMsg): string {
  return formatUserDisplayName(m.sender_display_name, m.sender_username);
}

function rowToThreadMsg(row: Record<string, unknown>): ThreadMsg {
  const created =
    row.created_at != null
      ? typeof row.created_at === "string"
        ? row.created_at
        : String(row.created_at)
      : undefined;
  const reactionsRaw = row.reactions;
  let reactions: ThreadMsg["reactions"];
  if (Array.isArray(reactionsRaw)) {
    reactions = reactionsRaw.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        emoji: String(o.emoji ?? ""),
        count: Math.max(0, Math.floor(Number(o.count ?? 0))),
        includes_me: Boolean(o.includes_me),
      };
    });
  }
  const rt = row.reply_to_message;
  let reply_to_message: ThreadMsg["reply_to_message"] = null;
  if (rt && typeof rt === "object" && !Array.isArray(rt)) {
    const o = rt as Record<string, unknown>;
    reply_to_message = {
      id: o.id != null ? String(o.id) : undefined,
      sender_id: o.sender_id != null ? String(o.sender_id) : undefined,
      content_snippet: o.content_snippet != null ? String(o.content_snippet) : undefined,
      message_type: o.message_type != null ? String(o.message_type) : undefined,
      created_at: o.created_at != null ? String(o.created_at) : undefined,
      deleted: Boolean(o.deleted),
    };
  }
  const pid = row.parent_message_id ?? row.reply_to_message_id;
  return {
    id: row.id != null ? String(row.id) : undefined,
    sender_id: row.sender_id != null ? String(row.sender_id) : undefined,
    recipient_id: row.recipient_id != null ? String(row.recipient_id) : null,
    group_id: row.group_id != null ? String(row.group_id) : null,
    message_type: row.message_type != null ? String(row.message_type) : undefined,
    content: row.content != null ? String(row.content) : undefined,
    subject: row.subject != null ? String(row.subject) : undefined,
    created_at: created,
    edited_at: row.edited_at != null ? String(row.edited_at) : null,
    deleted_at: row.deleted_at != null ? String(row.deleted_at) : null,
    recalled_at: row.recalled_at != null ? String(row.recalled_at) : null,
    sender_username: row.sender_username != null ? String(row.sender_username) : undefined,
    sender_display_name: row.sender_display_name != null ? String(row.sender_display_name) : null,
    recipient_username: row.recipient_username != null ? String(row.recipient_username) : undefined,
    recipient_display_name: row.recipient_display_name != null ? String(row.recipient_display_name) : null,
    reply_to_message_id: pid != null && String(pid).trim() ? String(pid) : null,
    reply_to_message,
    reactions,
  };
}

function createdRowToThreadMsg(row: MessagingMessageRow): ThreadMsg {
  return rowToThreadMsg(row as unknown as Record<string, unknown>);
}

function mapThreadMessages(msgs: unknown[] | undefined): ThreadMsg[] {
  return (msgs ?? []).map((x) => rowToThreadMsg(x as Record<string, unknown>));
}

function siteOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/\/$/, "");
}

function buildMailto(to: string, subject: string, body: string): string {
  const origin = siteOrigin();
  const footer = origin ? `\n\n—\nHousing on OCH: ${origin}\n(They may not have an account yet — invite them to join.)` : "";
  const q = new URLSearchParams({
    subject: subject || "Message from OCH Housing",
    body: `${body}${footer}`,
  });
  return `mailto:${to.trim()}?${q.toString()}`;
}

export type MessagesWorkspaceProps = {
  initialThreadId?: string | null;
  variant?: "sidebar" | "page" | "drawer";
  /** Prefill compose (e.g. community post author UUID). */
  prefillRecipient?: string | null;
  prefillSubject?: string | null;
  /** Open compose on email/SMS (e.g. `?compose=external` from account redirect). */
  initialComposeChannel?: "och" | "email" | "sms";
};

export function MessagesWorkspace({
  initialThreadId = null,
  variant = "page",
  prefillRecipient = null,
  prefillSubject = null,
  initialComposeChannel = "och",
}: MessagesWorkspaceProps) {
  const router = useRouter();
  const { token, currentUserId, authHydrating, authReady, syncFromStorage } = useMessagesAuth();
  const [threads, setThreads] = useState<MessagingThreadSummary[]>([]);
  const [bookingUpdates, setBookingUpdates] = useState<MessagingThreadSummary[]>([]);
  const [serverBookingUpdates, setServerBookingUpdates] = useState<MessagingThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [bookingUpdatesLoading, setBookingUpdatesLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [bookingUpdatesLoaded, setBookingUpdatesLoaded] = useState(false);
  const [bookingUpdatesWarning, setBookingUpdatesWarning] = useState<string | null>(null);
  const [inboxTab, setInboxTab] = useState<"messages" | "booking">("messages");
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId || null);
  /** Thread id that `messages` currently represent (may lag `selectedId` while a fetch is in flight). */
  const [displayedThreadId, setDisplayedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  /** True while fetching a thread that is not served from cache (stale prior messages may still be visible). */
  const [threadBodyLoading, setThreadBodyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientCandidates, setRecipientCandidates] = useState<MessagingUserSearchResult[]>([]);
  const [composeBody, setComposeBody] = useState("");
  const [composeChannel, setComposeChannel] = useState<"och" | "email" | "sms">(initialComposeChannel);
  const [extHistory, setExtHistory] = useState<ExternalContactHistoryRow[]>([]);
  const [extEmail, setExtEmail] = useState("");
  const [extPhone, setExtPhone] = useState("");
  const [extSubject, setExtSubject] = useState("");
  const [extBody, setExtBody] = useState("");
  const [extListingId, setExtListingId] = useState("");
  const [extNotice, setExtNotice] = useState<string | null>(null);
  const [extCaps, setExtCaps] = useState<ExternalContactCapabilities | null>(null);
  /** Guest drawer mailto fields (kept separate from signed-in compose). */
  const [guestEmail, setGuestEmail] = useState("");
  const [guestSubject, setGuestSubject] = useState("");
  const [guestBody, setGuestBody] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupBusy, setNewGroupBusy] = useState(false);
  const [groupDetail, setGroupDetail] = useState<MessagingGroupDetail | null>(null);
  const [groupAddQuery, setGroupAddQuery] = useState("");
  const [groupAddCandidates, setGroupAddCandidates] = useState<MessagingUserSearchResult[]>([]);
  const [threadActionBusy, setThreadActionBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ThreadMsg | null>(null);
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  /** Messages hidden “for me” in this thread — recovery list (same ordering as server). */
  const [hiddenRecoveryMessages, setHiddenRecoveryMessages] = useState<ThreadMsg[]>([]);
  const [hiddenRecoveryOpen, setHiddenRecoveryOpen] = useState(false);

  const myId = useMemo(() => currentUserId || getSubFromJwt(token), [currentUserId, token]);

  const threadMessagesCache = useRef(new Map<string, ThreadMsg[]>());
  const messageRowRefs = useRef(new Map<string, HTMLLIElement | null>());
  const bookingProjectionByThreadIdRef = useRef(new Map<string, BookingUpdateProjection>());
  const selectedIdRef = useRef<string | null>(selectedId);
  const inboxInFlightRef = useRef<Promise<void> | null>(null);
  const inboxRequestSeqRef = useRef(0);
  const inboxReloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGoodThreadsRef = useRef<MessagingThreadSummary[]>([]);
  const lastGoodBookingUpdatesRef = useRef<MessagingThreadSummary[]>([]);
  selectedIdRef.current = selectedId;

  const threadPaneInSync = useMemo(
    () => Boolean(selectedId && displayedThreadId === selectedId && !threadBodyLoading),
    [selectedId, displayedThreadId, threadBodyLoading],
  );

  const selectedSummary = useMemo(() => {
    const fromMain = threads.find((t) => t.id === selectedId);
    if (fromMain) return fromMain;
    return bookingUpdates.find((t) => t.id === selectedId) ?? null;
  }, [threads, bookingUpdates, selectedId]);

  useEffect(() => {
    setEditingMessageId(null);
    setEditDraft("");
    setEditSaving(false);
    setFlashMessageId(null);
    setHiddenRecoveryOpen(false);
  }, [selectedId]);

  const loadHiddenRecovery = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (!token || !sid) {
      setHiddenRecoveryMessages([]);
      return;
    }
    try {
      const pack = await getMessagingThreadHiddenForMe(token, sid);
      setHiddenRecoveryMessages(mapThreadMessages(pack.messages as unknown[]));
    } catch {
      setHiddenRecoveryMessages([]);
    }
  }, [token]);

  useEffect(() => {
    void loadHiddenRecovery();
  }, [token, selectedId, displayedThreadId, loadHiddenRecovery]);

  useEffect(() => {
    if (initialThreadId) {
      setSelectedId(initialThreadId);
    } else if (variant === "page") {
      setSelectedId(null);
    }
  }, [initialThreadId, variant]);

  useEffect(() => {
    const r = (prefillRecipient ?? "").trim();
    if (r) {
      if (UUID_RE.test(r)) {
        setRecipientId(r);
      } else {
        setRecipientQuery(r);
      }
    }
    const s = (prefillSubject ?? "").trim();
    if (s) setExtSubject(s);
  }, [prefillRecipient, prefillSubject]);

  useEffect(() => {
    setComposeChannel(initialComposeChannel);
  }, [initialComposeChannel]);

  useEffect(() => {
    if (!token) {
      setExtHistory([]);
      setExtCaps(null);
      return;
    }
    let cancelled = false;
    void listMessagingExternalContacts(token, 30)
      .then((rows) => {
        if (!cancelled) setExtHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setExtHistory([]);
      });
    void getMessagingExternalContactCapabilities(token)
      .then((c) => {
        if (!cancelled) setExtCaps(c);
      })
      .catch(() => {
        if (!cancelled) setExtCaps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadBookingUpdatesOnly = useCallback(
    async (reason: InboxLoadReason, background = false) => {
      if (!token || !currentUserId) return;
      if (!background || bookingUpdates.length === 0) {
        setBookingUpdatesLoading(true);
      }
      try {
        const result = await loadBookingUpdatesForUser(token, currentUserId, serverBookingUpdates, reason);
        bookingProjectionByThreadIdRef.current = result.projectionByThreadId;
        if (result.bookingUpdates.length > 0 || !background) {
          lastGoodBookingUpdatesRef.current = result.bookingUpdates;
          setBookingUpdates(result.bookingUpdates);
        }
        setBookingUpdatesLoaded(true);
        const onlyRateLimited =
          result.warnings.length > 0 &&
          result.warnings.every((w) => classifyFetchFailure(new Error(w)) === "rate-limited");
        setBookingUpdatesWarning(
          result.bookingUpdates.length > 0 && onlyRateLimited
            ? null
            : result.warnings.length
              ? result.warnings.join(" · ")
              : null,
        );
      } finally {
        setBookingUpdatesLoading(false);
      }
    },
    [token, currentUserId, serverBookingUpdates, bookingUpdates.length],
  );

  const loadInitialInbox = useCallback(
    async (reason: InboxLoadReason, opts?: { background?: boolean }) => {
      if (!token || !currentUserId) return;
      if (inboxInFlightRef.current) return inboxInFlightRef.current;

      const seq = ++inboxRequestSeqRef.current;
      const background = Boolean(opts?.background);
      const hadThreads = lastGoodThreadsRef.current.length > 0;
      const hadBooking = lastGoodBookingUpdatesRef.current.length > 0;

      logMessagesDebug("inbox:load-start", { reason, userId: currentUserId, authReady: true, background });
      if (!background || !hadThreads) setThreadsLoading(true);
      if (!background || !hadBooking) setBookingUpdatesLoading(true);
      if (!background) setError(null);

      const task = (async () => {
        const threadsResult = await loadMessagingThreadsForUser(token, reason);
        if (seq !== inboxRequestSeqRef.current) return;

        if (threadsResult.threads.length > 0 || !background) {
          lastGoodThreadsRef.current = threadsResult.threads;
          setThreads(threadsResult.threads);
        } else if (hadThreads) {
          setThreads(lastGoodThreadsRef.current);
        }
        setServerBookingUpdates(threadsResult.serverBookingUpdates);
        if (threadsResult.error && threadsResult.threads.length === 0 && !hadThreads) {
          setError(threadsResult.error);
        } else if (threadsResult.threads.length > 0 || hadThreads) {
          setError(null);
        }
        setThreadsLoading(false);

        const bookingResult = await loadBookingUpdatesForUser(
          token,
          currentUserId,
          threadsResult.serverBookingUpdates,
          reason,
        );
        if (seq !== inboxRequestSeqRef.current) return;

        bookingProjectionByThreadIdRef.current = bookingResult.projectionByThreadId;
        if (bookingResult.bookingUpdates.length > 0 || !background) {
          lastGoodBookingUpdatesRef.current = bookingResult.bookingUpdates;
          setBookingUpdates(bookingResult.bookingUpdates);
        } else if (hadBooking) {
          setBookingUpdates(lastGoodBookingUpdatesRef.current);
        }
        setBookingUpdatesLoaded(true);
        const onlyRateLimited =
          bookingResult.warnings.length > 0 &&
          bookingResult.warnings.every((w) => classifyFetchFailure(new Error(w)) === "rate-limited");
        setBookingUpdatesWarning(
          bookingResult.bookingUpdates.length > 0 && onlyRateLimited
            ? null
            : bookingResult.warnings.length
              ? bookingResult.warnings.join(" · ")
              : null,
        );
        setBookingUpdatesLoading(false);
        setInitialLoadDone(true);
        markInboxLoadedForUser(currentUserId);
        logMessagesDebug("inbox:load-done", {
          reason,
          threadCount: threadsResult.threads.length,
          bookingCount: bookingResult.bookingUpdates.length,
        });
      })();

      inboxInFlightRef.current = task;
      try {
        await task;
      } finally {
        if (seq === inboxRequestSeqRef.current) {
          inboxInFlightRef.current = null;
        }
      }
    },
    [token, currentUserId],
  );

  const scheduleInboxReload = useCallback(
    (reason: InboxLoadReason) => {
      if (inboxReloadDebounceRef.current) clearTimeout(inboxReloadDebounceRef.current);
      inboxReloadDebounceRef.current = setTimeout(() => {
        inboxReloadDebounceRef.current = null;
        void loadInitialInbox(reason, { background: true });
      }, 250);
    },
    [loadInitialInbox],
  );

  const loadThreads = useCallback(
    async (reason: InboxLoadReason = "manual-refresh") => {
      await loadInitialInbox(reason);
    },
    [loadInitialInbox],
  );

  const persistThreadReadAndRefresh = useCallback(
    async (threadIdForServer: string) => {
      if (!token || !threadIdForServer) return;
      try {
        await markMessagingThreadRead(token, threadIdForServer);
        await loadThreads();
      } catch {
        /* non-fatal: badge may lag until next poll */
      }
    },
    [token, loadThreads],
  );

  const replacePageThreadQuery = useCallback(
    (threadId: string) => {
      if (variant !== "page" || typeof window === "undefined") return;
      const qs = new URLSearchParams(window.location.search);
      qs.set("thread", threadId);
      router.replace(`/dashboard/messages?${qs.toString()}`);
    },
    [variant, router],
  );

  const refreshActiveThread = useCallback(async () => {
    const sid = selectedIdRef.current;
    if (!token || !sid) return;
    setError(null);
    try {
      const t = await getMessagingThread(token, sid);
      const canonical = String(t.thread_id || "").trim();
      let effectiveId = sid;
      if (UUID_RE.test(canonical) && canonical !== sid) {
        effectiveId = canonical;
        setSelectedId(canonical);
        replacePageThreadQuery(canonical);
      }
      const rows = mapThreadMessages(t.messages as unknown[]);
      threadMessagesCache.current.set(effectiveId, rows);
      if (selectedIdRef.current === effectiveId || selectedIdRef.current === sid) {
        setMessages(rows);
        setDisplayedThreadId(effectiveId);
      }
      void persistThreadReadAndRefresh(sid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load thread");
    }
  }, [token, replacePageThreadQuery, persistThreadReadAndRefresh]);

  useEffect(() => {
    if (shouldClearInboxForAuthChange(currentUserId)) {
      setThreads([]);
      setBookingUpdates([]);
      setServerBookingUpdates([]);
      lastGoodThreadsRef.current = [];
      lastGoodBookingUpdatesRef.current = [];
      bookingProjectionByThreadIdRef.current.clear();
      setInitialLoadDone(false);
      setBookingUpdatesLoaded(false);
      setBookingUpdatesWarning(null);
      setError(null);
    }
    if (!authReady || !token || !currentUserId) return;
    void loadInitialInbox("auth-ready");
  }, [authReady, token, currentUserId, loadInitialInbox]);

  useEffect(
    () => () => {
      if (inboxReloadDebounceRef.current) clearTimeout(inboxReloadDebounceRef.current);
    },
    [],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      syncFromStorage();
      if (authReady && token && currentUserId && !initialLoadDone) {
        void loadInitialInbox("visibility-retry");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authReady, token, currentUserId, initialLoadDone, loadInitialInbox, syncFromStorage]);

  useEffect(() => {
    const onNotificationsRead = (ev: Event) => {
      const custom = ev as CustomEvent<{
        notificationIds?: string[];
        bookingId?: string;
      }>;
      const bid = String(custom.detail?.bookingId || "").trim().toLowerCase();
      const nids = new Set(
        (custom.detail?.notificationIds ?? []).map((id) => String(id).trim().toLowerCase()),
      );
      if (bid || nids.size > 0) {
        setBookingUpdates((prev) =>
          prev.map((row) => {
            const rowNid = row.id.startsWith("notif:") ? row.id.slice(6).toLowerCase() : "";
            const rowBid = row.id.startsWith("booking:") ? row.id.slice(8).toLowerCase() : "";
            if ((rowNid && nids.has(rowNid)) || (bid && rowBid === bid)) {
              return { ...row, unreadCount: 0 };
            }
            return row;
          }),
        );
      }
    };
    const onBadgesRefresh = () => {
      onBadgesRefreshForInbox({ authReady, token, currentUserId }, (reason) => {
        scheduleInboxReload(reason);
      });
    };
    window.addEventListener("och:notifications-read", onNotificationsRead);
    window.addEventListener("och:badges-refresh", onBadgesRefresh);
    return () => {
      window.removeEventListener("och:notifications-read", onNotificationsRead);
      window.removeEventListener("och:badges-refresh", onBadgesRefresh);
    };
  }, [authReady, token, currentUserId, scheduleInboxReload, loadBookingUpdatesOnly]);

  useEffect(() => {
    if (!selectedId) return;
    if (bookingUpdates.some((x) => x.id === selectedId)) setInboxTab("booking");
    else if (threads.some((x) => x.id === selectedId)) setInboxTab("messages");
  }, [selectedId, bookingUpdates, threads]);

  useEffect(() => {
    if (!token || !selectedId) {
      setMessages([]);
      setDisplayedThreadId(null);
      setThreadBodyLoading(false);
      return;
    }

    if (selectedId.startsWith("notif:")) {
      setMessages([]);
      setDisplayedThreadId(selectedId);
      setThreadBodyLoading(false);
      setError(null);
      return;
    }

    const sid = selectedId;
    const cached = threadMessagesCache.current.get(sid);
    if (cached) {
      setMessages(cached);
      setDisplayedThreadId(sid);
      setThreadBodyLoading(false);
      setError(null);
      let cancelled = false;
      void getMessagingThread(token, sid)
        .then((t) => {
          if (cancelled || selectedIdRef.current !== sid) return;
          const canonical = String(t.thread_id || "").trim();
          let effectiveId = sid;
          if (UUID_RE.test(canonical) && canonical !== sid) {
            effectiveId = canonical;
            threadMessagesCache.current.set(
              sid,
              threadMessagesCache.current.get(sid) ?? mapThreadMessages(t.messages as unknown[]),
            );
            setSelectedId(canonical);
            replacePageThreadQuery(canonical);
          }
          const rows = mapThreadMessages(t.messages as unknown[]);
          threadMessagesCache.current.set(effectiveId, rows);
          if (selectedIdRef.current === effectiveId) {
            setMessages(rows);
            setDisplayedThreadId(effectiveId);
          }
        })
        .catch(() => {
          /* keep cached copy */
        });
      return () => {
        cancelled = true;
      };
    }

    setThreadBodyLoading(true);
    setError(null);
    let cancelled = false;

    void (async () => {
      let effectiveId = sid;
      try {
        const t = await getMessagingThread(token, sid);
        if (cancelled || selectedIdRef.current !== sid) return;
        const canonical = String(t.thread_id || "").trim();
        if (UUID_RE.test(canonical) && canonical !== sid) {
          effectiveId = canonical;
          setSelectedId(canonical);
          replacePageThreadQuery(canonical);
        }
        const rows = mapThreadMessages(t.messages as unknown[]);
        threadMessagesCache.current.set(effectiveId, rows);
        if (selectedIdRef.current !== effectiveId && selectedIdRef.current !== sid) return;
        setMessages(rows);
        setDisplayedThreadId(effectiveId);
        void persistThreadReadAndRefresh(sid);
      } catch (e: unknown) {
        if (!cancelled && selectedIdRef.current === sid) {
          setError(e instanceof Error ? e.message : "Failed to load thread");
        }
      } finally {
        if (!cancelled && (selectedIdRef.current === sid || selectedIdRef.current === effectiveId)) {
          setThreadBodyLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, selectedId, replacePageThreadQuery, persistThreadReadAndRefresh]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) {
        setRecipientCandidates([]);
        return;
      }
      const q = recipientQuery.trim();
      if (q.length < 2) {
        setRecipientCandidates([]);
        return;
      }
      try {
        const users = await searchMessagingUsers(token, q);
        if (!cancelled) setRecipientCandidates(users);
      } catch {
        if (!cancelled) setRecipientCandidates([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, recipientQuery]);

  const resolveComposeRecipientUserId = useCallback(async (): Promise<string> => {
    const rid = recipientId.trim();
    if (UUID_RE.test(rid)) return rid;
    const handle = recipientQuery.trim().replace(/^@+/, "");
    if (!handle) {
      throw new Error("Enter a recipient username.");
    }
    const lower = handle.toLowerCase();
    const exactFromList = recipientCandidates.find((u) => {
      const un = (u.username || "").trim().toLowerCase();
      const dn = (u.display_name || "").trim().toLowerCase();
      return (un && un === lower) || (dn && dn === lower);
    });
    if (exactFromList?.id && UUID_RE.test(String(exactFromList.id))) {
      return String(exactFromList.id).trim();
    }
    if (
      recipientCandidates.length === 1 &&
      recipientCandidates[0]?.id &&
      UUID_RE.test(String(recipientCandidates[0].id))
    ) {
      return String(recipientCandidates[0].id).trim();
    }
    const matches = await resolveTrustPublicUserHandle(handle);
    if (matches.length === 0) {
      throw new Error("User not found. Check the username and try again.");
    }
    if (matches.length > 1) {
      const exact = matches.find((m) => (m.username || "").trim().toLowerCase() === lower);
      if (exact?.id && UUID_RE.test(String(exact.id))) return String(exact.id).trim();
      throw new Error("Multiple users match — pick the right person from search results.");
    }
    const only = matches[0];
    const id = only?.id != null ? String(only.id).trim() : "";
    if (!UUID_RE.test(id)) {
      throw new Error("User not found. Check the username and try again.");
    }
    return id;
  }, [recipientId, recipientQuery, recipientCandidates]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) {
        setGroupAddCandidates([]);
        return;
      }
      const q = groupAddQuery.trim();
      if (q.length < 2) {
        setGroupAddCandidates([]);
        return;
      }
      try {
        const users = await searchMessagingUsers(token, q);
        if (!cancelled) setGroupAddCandidates(users);
      } catch {
        if (!cancelled) setGroupAddCandidates([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, groupAddQuery]);

  const isGroup = useMemo(
    () => Boolean(selectedSummary?.kind === "group" || messages.some((m) => m.group_id)),
    [selectedSummary?.kind, messages],
  );
  const groupId = useMemo(() => {
    if (selectedSummary?.kind === "group" && selectedId) return selectedId;
    const fromMsg = messages.find((m) => m.group_id)?.group_id;
    return fromMsg ?? null;
  }, [selectedSummary?.kind, selectedId, messages]);

  useEffect(() => {
    if (!token || !selectedId || selectedSummary?.kind !== "group") {
      setGroupDetail(null);
      return;
    }
    let cancelled = false;
    void getMessagingGroup(token, selectedId)
      .then((g) => {
        if (!cancelled) setGroupDetail(g);
      })
      .catch(() => {
        if (!cancelled) setGroupDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedId, selectedSummary?.kind]);

  const myGroupRole = useMemo(() => {
    if (!myId || !groupDetail?.members) return null;
    const row = groupDetail.members.find((m) => String(m.user_id) === String(myId));
    return row?.role ?? null;
  }, [groupDetail, myId]);

  const canManageGroupMembers = useMemo(() => {
    const r = (myGroupRole || "").toLowerCase();
    return r === "owner" || r === "admin" || r === "moderator";
  }, [myGroupRole]);

  const otherUserId = useMemo(() => {
    if (!myId || isGroup) return null;
    const me = String(myId);
    for (const m of messages) {
      const s = m.sender_id != null ? String(m.sender_id) : "";
      const r = m.recipient_id != null ? String(m.recipient_id) : "";
      if (s && r) {
        if (s === me) return r;
        if (r === me) return s;
      }
    }
    return null;
  }, [messages, myId, isGroup]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!token || !UUID_RE.test(messageId) || !emoji.trim()) return;
      const key = `${messageId}:${emoji}`;
      const msg = messages.find((x) => String(x.id) === messageId);
      const row = (msg?.reactions ?? []).find((r) => r.emoji === emoji);
      const had = Boolean(row?.includes_me);
      const optimistic = (prev: ThreadMsg[]) =>
        prev.map((m) => {
          if (String(m.id) !== messageId) return m;
          const cur = [...(m.reactions ?? [])];
          const idx = cur.findIndex((r) => r.emoji === emoji);
          if (had) {
            if (idx < 0) return m;
            const nextCount = Math.max(0, cur[idx].count - 1);
            const nextR =
              nextCount > 0
                ? cur.map((r, i) => (i === idx ? { ...r, count: nextCount, includes_me: false } : r))
                : cur.filter((_, i) => i !== idx);
            return { ...m, reactions: nextR };
          }
          if (idx >= 0) {
            return {
              ...m,
              reactions: cur.map((r, i) =>
                i === idx ? { ...r, count: r.count + 1, includes_me: true } : r,
              ),
            };
          }
          return { ...m, reactions: [...cur, { emoji, count: 1, includes_me: true }] };
        });
      setReactionBusy(key);
      setMessages((prev) => {
        const next = optimistic(prev);
        if (selectedId) threadMessagesCache.current.set(selectedId, next);
        return next;
      });
      try {
        if (had) await deleteMessagingReaction(token, messageId, emoji);
        else await postMessagingReaction(token, messageId, emoji);
        await refreshActiveThread();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Reaction failed");
        await refreshActiveThread();
      } finally {
        setReactionBusy(null);
      }
    },
    [token, messages, selectedId, refreshActiveThread],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    const id = String(messageId).trim();
    if (!UUID_RE.test(id)) return;
    const el = messageRowRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashMessageId(id);
    window.setTimeout(() => {
      setFlashMessageId((cur) => (cur === id ? null : cur));
    }, 2200);
  }, []);

  const handleStartEdit = useCallback((m: ThreadMsg) => {
    if (!m.id) return;
    setEditingMessageId(String(m.id));
    setEditDraft(String(m.content ?? ""));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!token || !editingMessageId) return;
    const next = editDraft.trim();
    if (!next) return;
    setEditSaving(true);
    setError(null);
    try {
      await patchMessagingMessage(token, editingMessageId, { content: next });
      setEditingMessageId(null);
      setEditDraft("");
      await refreshActiveThread();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save edit");
    } finally {
      setEditSaving(false);
    }
  }, [token, editingMessageId, editDraft, refreshActiveThread]);

  const handleHideMessageForMe = useCallback(
    async (m: ThreadMsg) => {
      if (!token || !m.id) return;
      const mid = String(m.id);
      if (!UUID_RE.test(mid)) return;
      setError(null);
      const sid = selectedIdRef.current;
      if (sid) {
        const cur = threadMessagesCache.current.get(sid);
        if (cur) {
          threadMessagesCache.current.set(
            sid,
            cur.filter((x) => String(x.id) !== mid),
          );
        }
        setMessages((prev) => (selectedIdRef.current === sid ? prev.filter((x) => String(x.id) !== mid) : prev));
      }
      try {
        await hideMessagingMessageForMe(token, mid);
        if (editingMessageId === mid) handleCancelEdit();
        await refreshActiveThread();
        await loadHiddenRecovery();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to hide message");
        await refreshActiveThread();
      }
    },
    [token, refreshActiveThread, editingMessageId, handleCancelEdit, loadHiddenRecovery],
  );

  const handleUnhideMessageForMe = useCallback(
    async (hm: ThreadMsg) => {
      if (!token || !hm.id) return;
      const mid = String(hm.id);
      if (!UUID_RE.test(mid)) return;
      setError(null);
      try {
        await unhideMessagingMessageForMe(token, mid);
        setHiddenRecoveryMessages((prev) => prev.filter((x) => String(x.id) !== mid));
        await refreshActiveThread();
        await loadHiddenRecovery();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not restore message");
        await loadHiddenRecovery();
        await refreshActiveThread();
      }
    },
    [token, refreshActiveThread, loadHiddenRecovery],
  );

  const handleDeleteForEveryone = useCallback(
    async (m: ThreadMsg) => {
      if (!token || !m.id) return;
      const mid = String(m.id);
      if (!UUID_RE.test(mid)) return;
      if (!window.confirm("Remove this message for everyone? They will see a small “removed” placeholder.")) return;
      setError(null);
      try {
        await deleteMessagingMessage(token, mid);
        if (editingMessageId === mid) handleCancelEdit();
        await refreshActiveThread();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to delete message");
      }
    },
    [token, refreshActiveThread, editingMessageId, handleCancelEdit],
  );

  async function onSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !selectedId || !body.trim()) return;
    if (!threadPaneInSync) return;
    if (!isGroup && !otherUserId) return;
    setSending(true);
    setError(null);
    const subject = isGroup ? (groupThreadSubjectLine(messages).slice(0, 240) || "Group chat") : "";
    const replyToId =
      replyingTo?.id && UUID_RE.test(String(replyingTo.id)) ? String(replyingTo.id).trim() : undefined;
    try {
      const created = isGroup && groupId
        ? await postMessagingMessage(token, {
            group_id: groupId,
            message_type: "General",
            subject,
            content: body.trim(),
            ...(replyToId ? { reply_to_message_id: replyToId } : {}),
          })
        : await postMessagingMessage(token, {
            recipient_id: otherUserId!,
            message_type: "General",
            subject,
            content: body.trim(),
            thread_id: selectedId,
            ...(replyToId ? { reply_to_message_id: replyToId } : {}),
          });
      const replySnap = replyingTo;
      setBody("");
      setReplyingTo(null);
      const bubble = createdRowToThreadMsg(created);
      if (replyToId && replySnap) {
        bubble.reply_to_message_id = replyToId;
        bubble.reply_to_message = {
          id: replySnap.id,
          sender_id: replySnap.sender_id,
          content_snippet: String(replySnap.content || "").slice(0, 200),
          message_type: replySnap.message_type,
          created_at: replySnap.created_at,
        };
      }
      setMessages((prev) => {
        const id = bubble.id;
        if (id && prev.some((m) => String(m.id) === id)) return prev;
        const next = [...prev, bubble].sort(
          (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
        );
        if (selectedId) threadMessagesCache.current.set(selectedId, next);
        return next;
      });
      void Promise.all([refreshActiveThread(), loadThreads()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onSendNew(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !composeBody.trim()) {
      setError("Write a message before sending.");
      return;
    }
    const handleHint = recipientId.trim() || recipientQuery.trim().replace(/^@+/, "");
    if (!handleHint) {
      setError("Enter a recipient username.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const resolvedRecipientId = await resolveComposeRecipientUserId();
      if (myId && resolvedRecipientId === String(myId)) {
        setError("You cannot message yourself.");
        return;
      }
      const created = await postMessagingMessage(token, {
        recipient_id: resolvedRecipientId,
        message_type: "General",
        subject: "",
        content: composeBody.trim(),
      });
      setComposeBody("");
      setRecipientId("");
      setRecipientQuery("");
      setRecipientCandidates([]);
      await loadThreads();
      const tid = String(created.thread_id || "").trim();
      if (UUID_RE.test(tid)) selectThread(tid);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onSendExternalEmail() {
    if (!token || !extEmail.trim() || !extBody.trim() || !EMAIL_RE.test(extEmail.trim())) return;
    setSending(true);
    setError(null);
    setExtNotice(null);
    try {
      const to = extEmail.trim();
      const subj = extSubject.trim() || "OCH Housing";
      const origin = siteOrigin();
      const footer = origin ? `\n\n—\nHousing on OCH: ${origin}` : "";
      const bodyText = `${extBody.trim()}${footer}`;
      const out = await submitMessagingExternalContact(token, {
        contact_method: "email",
        recipient_email: to,
        subject: subj,
        body: bodyText,
        listing_id: UUID_RE.test(extListingId.trim()) ? extListingId.trim() : undefined,
      });
      if (!out.send_ok) {
        if (out.history) {
          setExtHistory(await listMessagingExternalContacts(token, 30));
        }
        setError(out.error || "Email transport rejected the message.");
        return;
      }
      setExtBody("");
      setExtSubject("");
      setExtEmail("");
      setExtListingId("");
      const mode = out.email_delivery_mode;
      const sinkNote =
        mode === "test_sink"
          ? " (Dev sink: captured locally — not proof of an outside inbox.)"
          : mode === "self_hosted_smtp"
            ? " (Self-hosted relay: confirm the message reached the recipient’s mailbox.)"
            : mode === "provider"
              ? " (Third-party relay: confirm delivery in the recipient’s mailbox.)"
              : "";
      setError(null);
      setExtNotice((out.message || "Email accepted by SMTP transport.") + sinkNote + " Logged to history — not a DM.");
      setExtHistory(await listMessagingExternalContacts(token, 30));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onSendExternalSms() {
    if (!token || !extPhone.trim() || !extBody.trim() || !PHONE_RE.test(extPhone.trim())) return;
    setSending(true);
    setError(null);
    setExtNotice(null);
    try {
      const origin = siteOrigin();
      const footer = origin ? `\n\n—\nHousing on OCH: ${origin}` : "";
      const bodyText = `${extBody.trim()}${footer}`;
      const out = await submitMessagingExternalContact(token, {
        contact_method: "sms",
        recipient_phone: extPhone.trim(),
        body: bodyText,
        listing_id: UUID_RE.test(extListingId.trim()) ? extListingId.trim() : undefined,
      });
      if (!out.send_ok) {
        if (out.history) {
          setExtHistory(await listMessagingExternalContacts(token, 30));
          setError(out.error || "SMS transport rejected the message.");
          return;
        }
        if (out.status === "dev_mock") {
          setExtBody("");
          setExtPhone("");
          setExtListingId("");
          setError(null);
          setExtNotice(
            out.message ||
              "Dev mock only: nothing was sent to a carrier. History records the attempt — not a DM.",
          );
          setExtHistory(await listMessagingExternalContacts(token, 30));
          return;
        }
        setError(out.error || "SMS send failed.");
        return;
      }
      setExtBody("");
      setExtPhone("");
      setExtListingId("");
      setError(null);
      const mode = out.sms_delivery_mode;
      const tail =
        mode === "self_hosted_gateway"
          ? " Confirm delivery on your gateway or handset."
          : mode === "provider"
            ? " Confirm delivery on the handset."
            : "";
      setExtNotice((out.message || "SMS accepted by transport.") + tail + " Logged to history — not a DM.");
      setExtHistory(await listMessagingExternalContacts(token, 30));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function onCreateGroupSubmit() {
    if (!token || !newGroupName.trim()) return;
    setNewGroupBusy(true);
    setError(null);
    try {
      const g = await createMessagingGroup(token, { name: newGroupName.trim() });
      setNewGroupOpen(false);
      setNewGroupName("");
      await loadThreads();
      const gid = String(g.id || "").trim();
      if (UUID_RE.test(gid)) selectThread(gid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create group");
    } finally {
      setNewGroupBusy(false);
    }
  }

  async function onArchiveSelectedThread() {
    if (!token || !selectedId) return;
    setThreadActionBusy(true);
    setError(null);
    try {
      await archiveMessagingThread(token, selectedId);
      threadMessagesCache.current.delete(selectedId);
      setSelectedId(null);
      setMessages([]);
      setDisplayedThreadId(null);
      if (variant === "page" && typeof window !== "undefined") {
        const qs = new URLSearchParams(window.location.search);
        qs.delete("thread");
        const q = qs.toString();
        router.replace(q ? `/dashboard/messages?${q}` : "/dashboard/messages");
      }
      await loadThreads();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setThreadActionBusy(false);
    }
  }

  async function onRemoveThreadFromInbox() {
    if (!token || !selectedId) return;
    if (
      !window.confirm(
        "Hide this conversation from your inbox? Other participants still keep their copy.",
      )
    )
      return;
    setThreadActionBusy(true);
    setError(null);
    try {
      await deleteMessagingThreadForUser(token, selectedId);
      setSelectedId(null);
      setMessages([]);
      await loadThreads();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setThreadActionBusy(false);
    }
  }

  async function onAddGroupMemberPick(userUuid: string) {
    if (!token || !groupId) return;
    setThreadActionBusy(true);
    setError(null);
    try {
      await addMessagingGroupMember(token, groupId, userUuid);
      setGroupAddQuery("");
      setGroupAddCandidates([]);
      setGroupDetail(await getMessagingGroup(token, groupId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Add member failed");
    } finally {
      setThreadActionBusy(false);
    }
  }

  async function onKickGroupMemberPick(targetUserId: string) {
    if (!token || !groupId) return;
    if (!window.confirm("Remove this member from the group?")) return;
    setThreadActionBusy(true);
    setError(null);
    try {
      await kickMessagingGroupMember(token, groupId, targetUserId);
      setGroupDetail(await getMessagingGroup(token, groupId));
      void loadThreads();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Remove member failed");
    } finally {
      setThreadActionBusy(false);
    }
  }

  function selectThread(id: string) {
    setSelectedId(id);
    if (variant === "page" && typeof window !== "undefined") {
      const qs = new URLSearchParams(window.location.search);
      qs.set("thread", id);
      router.replace(`/dashboard/messages?${qs.toString()}`);
    }
  }

  const guestAside = (
    <aside className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
      <p className="font-semibold text-slate-800">Messages</p>
      <p className="mt-2">Sign in for your conversation list, in-app DMs, and server-sent external email/SMS from OCH.</p>
      <Link href="/login" className="mt-2 inline-block text-teal-700 hover:underline">
        Go to login
      </Link>
    </aside>
  );

  if (authHydrating) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600"
        data-testid="messages-auth-loading"
      >
        Loading your messages…
      </div>
    );
  }

  if (!token || !currentUserId) {
    if (variant === "drawer") {
      return (
        <div className="flex h-full flex-col overflow-y-auto p-3">
          {guestAside}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Outside OCH (email)</p>
            <p className="mt-1 text-xs text-slate-600">Works without an OCH account on the other side — opens your mail client.</p>
            <div className="mt-2 space-y-2">
              <input
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                type="email"
                placeholder="friend@university.edu"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={guestSubject}
                onChange={(e) => setGuestSubject(e.target.value)}
                placeholder="Subject"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <textarea
                value={guestBody}
                onChange={(e) => setGuestBody(e.target.value)}
                placeholder="Your message…"
                rows={3}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={!guestEmail.trim() || !guestBody.trim() || !EMAIL_RE.test(guestEmail.trim())}
                className="w-full rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                onClick={() => {
                  if (!EMAIL_RE.test(guestEmail.trim())) return;
                  window.location.href = buildMailto(guestEmail, guestSubject, guestBody);
                }}
              >
                Open email app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return guestAside;
  }

  const inboxListClass =
    variant === "drawer"
      ? "max-h-36 shrink-0 space-y-1 overflow-y-auto px-2 py-2"
      : "max-h-52 shrink-0 space-y-1 overflow-y-auto px-2 py-2 md:max-h-none md:flex-1";

  const activeInboxThreads = inboxTab === "messages" ? threads : bookingUpdates;

  const inboxUiState = {
    authHydrating,
    authReady,
    threadsLoading,
    bookingUpdatesLoading,
    initialLoadDone,
    bookingUpdatesLoaded,
    inboxTab,
    threadCount: threads.length,
    bookingUpdateCount: bookingUpdates.length,
  };

  const inboxSection = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inbox</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-teal-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-teal-700"
            onClick={() => {
              setNewGroupOpen(true);
              setNewGroupName("");
            }}
          >
            New group
          </button>
          <button
            type="button"
            className="text-xs font-medium text-teal-700 hover:underline"
            onClick={() => void loadThreads()}
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-slate-100 px-2 pb-2">
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold ${
            inboxTab === "messages" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setInboxTab("messages")}
        >
          Messages
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold ${
            inboxTab === "booking" ? "bg-amber-700 text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => {
            setInboxTab("booking");
            if (
              shouldRetryBookingUpdatesOnTab({
                authReady,
                token,
                currentUserId,
                bookingUpdatesLoaded,
                bookingUpdatesLoading,
              })
            ) {
              void loadBookingUpdatesOnly("booking-tab");
            }
          }}
        >
          Booking updates
        </button>
      </div>
      {bookingUpdatesWarning ? (
        <p className="px-3 py-1 text-[10px] text-amber-800">{bookingUpdatesWarning}</p>
      ) : null}
      <ul className={inboxListClass} data-testid="messages-inbox-list">
        {shouldShowThreadsLoading(inboxUiState) ? (
          <li className="px-3 py-4 text-center text-xs text-slate-500" data-testid="messages-threads-loading">
            Loading conversations…
          </li>
        ) : null}
        {shouldShowBookingUpdatesLoading(inboxUiState) ? (
          <li className="px-3 py-4 text-center text-xs text-slate-500" data-testid="messages-booking-loading">
            Loading booking updates…
          </li>
        ) : null}
        {shouldShowInboxEmpty(inboxUiState) ? (
          <li className="px-3 py-4 text-center text-xs text-slate-500" data-testid="messages-inbox-empty">
            {inboxTab === "messages" ? "No direct messages yet." : "No booking updates yet."}
          </li>
        ) : null}
        {activeInboxThreads.map((th) => {
          const title =
            th.participantDisplay?.trim() ||
            (th.participantUsername ? `@${th.participantUsername}` : "") ||
            th.listingTitle;
          const listingBit = String(th.listingContextTitle || "").trim()
            ? prettyListingTitle(th.listingContextTitle)
            : "";
          const preview = prettyMessagePreview(th.lastMessagePreview);
          const subtitle = [listingBit, preview].filter(Boolean).join(" · ");
          return (
            <li key={th.id}>
              <button
                type="button"
                data-testid={`thread-row-${th.id}`}
                onClick={() => {
                  if (th.bookingHref && token) {
                    const projection = bookingProjectionByThreadIdRef.current.get(th.id);
                    if (projection) {
                      void openBookingNotificationFromProjection(token, projection, {
                        onLocalRead: () => {
                          setBookingUpdates((prev) =>
                            prev.map((row) =>
                              row.id === th.id ? { ...row, unreadCount: 0 } : row,
                            ),
                          );
                        },
                        navigate: (href) => router.push(href),
                      });
                      return;
                    }
                    router.push(th.bookingHref);
                    return;
                  }
                  setInboxTab(th.threadRole === "booking_update" ? "booking" : "messages");
                  selectThread(th.id);
                }}
                className={`w-full rounded-md px-2 py-2 text-left text-sm transition ${
                  selectedId === th.id ? "bg-teal-50 text-teal-950" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{title}</span>
                  {th.unreadCount && th.unreadCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {th.unreadCount}
                    </span>
                  ) : th.kind === "group" ? (
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      Group
                    </span>
                  ) : th.threadRole === "booking_update" ? (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                      Booking
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-slate-500">{subtitle}</p>
                {th.lastAt ? <p className="truncate text-[10px] text-slate-400">{formatMessageTime(th.lastAt)}</p> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const modeToggle = null;

  const threadEmptyClass =
    variant === "drawer"
      ? "flex min-h-[6rem] flex-1 items-center justify-center border-t border-slate-100 p-4 text-center text-sm text-slate-500"
      : "hidden min-h-[12rem] flex-1 items-center justify-center border-t border-slate-100 p-6 text-sm text-slate-500 md:flex md:border-l md:border-t-0";

  const threadView = selectedId ? (
    <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100 md:border-l md:border-t-0">
      <div className="shrink-0 space-y-1 border-b border-slate-100 p-3">
        {variant !== "drawer" ? (
          <>
            <p className="text-sm font-semibold text-slate-900">
              {selectedSummary?.participantDisplay ??
                selectedSummary?.listingTitle ??
                (selectedId ? "New messages" : "Messages")}
            </p>
            {selectedSummary?.listingContextTitle ? (
              <p className="text-xs text-slate-600">
                About: {prettyListingTitle(selectedSummary.listingContextTitle)}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                {selectedSummary?.threadRole === "booking_update"
                  ? "Booking activity (not a free-form DM thread)"
                  : selectedSummary?.kind === "group"
                    ? "Group chat"
                    : "Chat"}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs font-semibold text-slate-800">
            {selectedSummary?.participantDisplay ?? selectedSummary?.listingTitle ?? "New messages"}
          </p>
        )}
        {modeToggle}
        {selectedSummary?.threadRole !== "booking_update" && selectedId ? (
          <div className="flex flex-wrap gap-1 pt-1">
            <button
              type="button"
              disabled={threadActionBusy}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void onArchiveSelectedThread()}
            >
              Archive
            </button>
            <button
              type="button"
              disabled={threadActionBusy}
              className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-800 hover:bg-rose-50 disabled:opacity-50"
              onClick={() => void onRemoveThreadFromInbox()}
            >
              Hide from inbox
            </button>
          </div>
        ) : null}
        {selectedSummary?.kind === "group" && selectedId ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-800">
            <p className="font-semibold text-slate-900">Group members</p>
            {!groupDetail ? (
              <p className="text-slate-500">Loading…</p>
            ) : (
              <>
                <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                  {(groupDetail.members || []).map((mem) => {
                    const uid = String(mem.user_id);
                    const isMe = Boolean(myId && uid === String(myId));
                    const canKickThis =
                      canManageGroupMembers &&
                      !isMe &&
                      (myGroupRole === "owner" || String(mem.role).toLowerCase() !== "owner");
                    return (
                      <li key={uid} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px]" title={uid}>
                          {uid.slice(0, 8)}… · {mem.role}
                        </span>
                        {canKickThis ? (
                          <button
                            type="button"
                            className="shrink-0 text-rose-700 hover:underline disabled:opacity-50"
                            disabled={threadActionBusy}
                            onClick={() => void onKickGroupMemberPick(uid)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {canManageGroupMembers ? (
                  <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                    <p className="text-[10px] font-medium text-slate-600">Add member</p>
                    <input
                      value={groupAddQuery}
                      onChange={(e) => setGroupAddQuery(e.target.value)}
                      placeholder="Search username…"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-[11px]"
                    />
                    {groupAddCandidates.length > 0 ? (
                      <ul className="max-h-24 overflow-y-auto rounded border border-slate-200 bg-white">
                        {groupAddCandidates.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              className="flex w-full px-2 py-1 text-left text-[11px] hover:bg-slate-50 disabled:opacity-50"
                              disabled={threadActionBusy}
                              onClick={() => void onAddGroupMemberPick(u.id)}
                            >
                              <span className="truncate">{u.display_name || u.username}</span>
                              <span className="text-slate-500"> @{u.username}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3">
        {threadBodyLoading && selectedId && selectedId !== displayedThreadId ? (
          <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[11px] text-slate-600" aria-live="polite">
            Loading this conversation…
          </div>
        ) : null}
        {hiddenRecoveryMessages.length > 0 ? (
          <div className="mb-3 rounded-lg border border-slate-200/95 bg-slate-50/95 px-2.5 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-medium text-slate-700 hover:text-slate-900"
              onClick={() => setHiddenRecoveryOpen((o) => !o)}
            >
              <span>
                Hidden for you
                <span className="font-normal text-slate-500"> · {hiddenRecoveryMessages.length}</span>
              </span>
              <span className="shrink-0 text-slate-400">{hiddenRecoveryOpen ? "▾" : "▸"}</span>
            </button>
            {hiddenRecoveryOpen ? (
              <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto border-t border-slate-200/80 pt-2">
                {hiddenRecoveryMessages.map((hm) => {
                  const hid = hm.id ? String(hm.id) : "";
                  const preview = prettyMessagePreview(String(hm.content || "").slice(0, 280));
                  return (
                    <li key={hid || hm.created_at} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-500">
                          {formatMessageSender(hm)}
                          {hm.created_at ? (
                            <span className="text-slate-400"> · {formatMessageTime(hm.created_at)}</span>
                          ) : null}
                        </p>
                        <p className="line-clamp-2 text-[11px] text-slate-800">{preview || "(empty)"}</p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-800 hover:bg-slate-100"
                        onClick={() => void handleUnhideMessageForMe(hm)}
                      >
                        Unhide
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
        <ul className="flex flex-col gap-4" aria-busy={threadBodyLoading && selectedId !== displayedThreadId ? true : undefined}>
          {threadBodyLoading && selectedId && selectedId !== displayedThreadId ? (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={`sk-${i}`} className={`flex w-full ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                  <div className="max-w-[min(100%,20rem)] space-y-2">
                    <div className="h-2 w-24 animate-pulse rounded bg-slate-200" />
                    <div className="h-16 w-full animate-pulse rounded-2xl bg-slate-100" />
                  </div>
                </li>
              ))}
            </>
          ) : null}
          {(!threadBodyLoading || displayedThreadId === selectedId) &&
            messages.map((m) => {
              const mine = myId != null && String(m.sender_id) === String(myId);
              const isSystem = isSystemEventContent(m.content, m.message_type);
              const rowKey = m.id || `${m.sender_id}-${m.created_at}`;
              const mid = m.id ? String(m.id) : "";
              const flash = mid && flashMessageId === mid;
              return (
                <li
                  key={rowKey}
                  ref={(el) => {
                    if (!mid || !UUID_RE.test(mid)) return;
                    if (el) messageRowRefs.current.set(mid, el);
                    else messageRowRefs.current.delete(mid);
                  }}
                  data-message-row={mid || undefined}
                  className={`flex w-full scroll-mt-24 ${isSystem ? "justify-center" : mine ? "justify-end" : "justify-start"} ${flash ? "rounded-xl ring-2 ring-teal-400/70 ring-offset-2 ring-offset-slate-50 transition-shadow duration-300" : ""}`}
                >
                  {isSystem ? (
                    <div className="max-w-[92%] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {m.content}
                    </div>
                  ) : (
                    <MessageBubble
                      m={m}
                      mine={mine}
                      isSystem={false}
                      reactionBusy={reactionBusy}
                      onToggleReaction={(messageId: string, emoji: string) => void toggleReaction(messageId, emoji)}
                      onReply={(bm: ThreadMsg) => setReplyingTo(bm)}
                      onEdit={(bm: ThreadMsg) => handleStartEdit(bm)}
                      onHideForMe={(bm: ThreadMsg) => void handleHideMessageForMe(bm)}
                      onDeleteForEveryone={
                        mine ? (bm: ThreadMsg) => void handleDeleteForEveryone(bm) : undefined
                      }
                      onJumpToReplyTarget={(targetId: string) => {
                        const tid = String(targetId).trim();
                        if (UUID_RE.test(tid)) jumpToMessage(tid);
                        else {
                          const fallback = (m as ThreadMsg).reply_to_message_id;
                          if (fallback && UUID_RE.test(String(fallback))) jumpToMessage(String(fallback));
                        }
                      }}
                      editing={Boolean(editingMessageId && mid && editingMessageId === mid)}
                      editDraft={editingMessageId === mid ? editDraft : ""}
                      onEditDraft={editingMessageId === mid ? setEditDraft : () => {}}
                      onSaveEdit={() => void handleSaveEdit()}
                      onCancelEdit={handleCancelEdit}
                      editSaving={editSaving}
                    />
                  )}
                </li>
              );
            })}
        </ul>
      </div>
      {selectedSummary?.threadRole === "booking_update" ? (
        <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-600">
          Booking updates stay in this thread for reference. Start a person-to-person message from{" "}
          <strong>Messages</strong> below.
        </div>
      ) : (
        <form onSubmit={(e) => void onSendReply(e)} className="shrink-0 space-y-2 border-t border-slate-100 p-3">
          {replyingTo ? (
            <div className="rounded-md border border-teal-200 bg-teal-50 px-2 py-2 text-xs text-teal-950">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">Replying to {formatMessageSender(replyingTo)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-teal-900/90">
                    {prettyMessagePreview(String(replyingTo.content || "").slice(0, 400))}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 font-medium text-teal-800 hover:underline"
                  onClick={() => setReplyingTo(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder={isGroup ? "Message the group…" : "Write a message…"}
          />
          <button
            type="submit"
            data-testid="thread-reply-send"
            disabled={
              sending ||
              !threadPaneInSync ||
              !body.trim() ||
              (!isGroup && !otherUserId)
            }
            className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  ) : (
    <div className={threadEmptyClass}>Select a conversation</div>
  );

  const composeSection = (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Communication</p>
      <p className="mt-1 text-[11px] text-slate-600">
        In-app messages stay in OCH. External email and SMS use the server&apos;s configured transport (see mode
        banners below), are logged to history, and never open an in-app DM thread. Full history:{" "}
        <Link href="/dashboard/account" className="font-medium text-teal-800 hover:underline">
          Account → history
        </Link>
        .
      </p>
      <div className="mt-2 flex gap-1">
        {(["och", "email", "sms"] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold ${
              composeChannel === ch ? "bg-teal-800 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
            onClick={() => {
              setComposeChannel(ch);
              setExtNotice(null);
            }}
          >
            {ch === "och" ? "In-app" : ch === "email" ? "Email" : "SMS"}
          </button>
        ))}
      </div>
      {extNotice ? (
        <p
          className={`mt-2 text-xs ${
            /dev mock|not delivered to a carrier|mock only/i.test(extNotice) ? "text-amber-950" : "text-emerald-900"
          }`}
        >
          {extNotice}
        </p>
      ) : null}
      {extCaps && extCaps.delivery_warnings.length > 0 ? (
        <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-950">
          <p className="font-semibold">Transport warnings (from server)</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {extCaps.delivery_warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {extCaps && composeChannel === "email" && (!extCaps.email_smtp_configured || extCaps.email_delivery_mode === "unconfigured") ? (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
          Email transport is not configured (set SMTP_HOST / SMTP_FROM and EMAIL_DELIVERY_MODE). Send email is disabled
          until a real relay or dev sink is wired — this is not an in-app DM.
        </p>
      ) : null}
      {extCaps && composeChannel === "email" && extCaps.email_smtp_configured && extCaps.email_delivery_mode === "test_sink" ? (
        <p className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
          <strong>Dev / test SMTP sink</strong> (Mailpit or similar). Messages are captured locally, not delivered to an
          outside mailbox. Check Mailpit at{" "}
          <a href="http://localhost:8025" className="font-medium text-teal-800 underline" target="_blank" rel="noreferrer">
            http://localhost:8025
          </a>{" "}
          when using Docker Compose.
        </p>
      ) : null}
      {extCaps && composeChannel === "email" && extCaps.email_smtp_configured && extCaps.email_delivery_mode === "self_hosted_smtp" ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-950">
          <strong>Self-hosted SMTP</strong> — Send email uses your relay (Postfix, Mailu, etc.). SPF/DKIM/DMARC are
          your responsibility. Final acceptance is the message in the recipient&apos;s real inbox.
        </p>
      ) : null}
      {extCaps && composeChannel === "email" && extCaps.email_smtp_configured && extCaps.email_delivery_mode === "provider" ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-950">
          <strong>Provider SMTP relay</strong> (e.g. SendGrid, SES). Confirm delivery in the recipient&apos;s mailbox.
        </p>
      ) : null}
      {extCaps && composeChannel === "sms" && extCaps.sms_delivery_mode === "mock" ? (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
          <strong>SMS dev mock</strong> — Send text logs a history row only; nothing is sent to a carrier or handset.
          For real SMS use SMS_DELIVERY_MODE=provider (Twilio) or self_hosted_gateway with SMS_SELF_HOSTED_URL.
        </p>
      ) : null}
      {extCaps && composeChannel === "sms" && extCaps.sms_delivery_mode === "self_hosted_gateway" ? (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-950">
          <strong>Self-hosted SMS gateway</strong> — OCH POSTs to <code className="rounded bg-white px-0.5">SMS_SELF_HOSTED_URL</code>.
          You control the modem/SMPP bridge behind that endpoint.
        </p>
      ) : null}
      {extCaps && composeChannel === "sms" && extCaps.sms_delivery_mode === "provider" ? (
        <p className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
          <strong>Provider SMS</strong> (Twilio). Send text uses your Twilio credentials; confirm on the handset.
        </p>
      ) : null}
      {extCaps && composeChannel === "sms" && extCaps.sms_delivery_mode === "unconfigured" ? (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-950">
          SMS transport is not configured. Set SMS_DELIVERY_MODE and matching env (Twilio, SMS_SELF_HOSTED_URL, or mock
          for dev). Send text is disabled until then.
        </p>
      ) : null}
      {composeChannel === "och" ? (
        <form onSubmit={(e) => void onSendNew(e)} className="mt-2 space-y-2">
          <input
            value={recipientQuery}
            onChange={(e) => {
              setRecipientQuery(e.target.value);
              setRecipientId("");
            }}
            placeholder="Search by username or display name"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          {recipientCandidates.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
              {recipientCandidates.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-slate-50"
                    onClick={() => {
                      setRecipientId(u.id);
                      setRecipientQuery(u.display_name || u.username || "");
                      setRecipientCandidates([]);
                    }}
                  >
                    <span className="truncate text-sm text-slate-900">{u.display_name || u.username}</span>
                    <span className="ml-2 shrink-0 text-xs text-slate-500">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {recipientId ? <p className="text-xs text-emerald-700">Recipient selected</p> : null}
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your message…"
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={
              sending ||
              !composeBody.trim() ||
              !(recipientId.trim() || recipientQuery.trim().replace(/^@+/, ""))
            }
            className="w-full rounded-md bg-teal-800 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send in OCH"}
          </button>
        </form>
      ) : composeChannel === "email" ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-600">
            Primary action: attempt a real SMTP send (not “save only”). History is written after the server accepts or
            rejects the message. Never creates an in-app DM thread.
          </p>
          <input
            value={extEmail}
            onChange={(e) => {
              setExtEmail(e.target.value);
            }}
            type="email"
            placeholder="Recipient email"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={extSubject}
            onChange={(e) => setExtSubject(e.target.value)}
            placeholder="Subject"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <textarea
            value={extBody}
            onChange={(e) => setExtBody(e.target.value)}
            placeholder="Message body…"
            rows={3}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={extListingId}
            onChange={(e) => setExtListingId(e.target.value)}
            placeholder="Related listing ID (optional)"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={
              sending ||
              !extEmail.trim() ||
              !extBody.trim() ||
              !EMAIL_RE.test(extEmail.trim()) ||
              Boolean(extCaps && (!extCaps.email_smtp_configured || extCaps.email_delivery_mode === "unconfigured"))
            }
            className="w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            onClick={() => void onSendExternalEmail()}
          >
            {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-600">
            Sends a real SMS when Twilio (or SMS_USE_MOCK) is configured. Otherwise the server returns a clear error — we
            do not pretend a text was delivered.
          </p>
          <input
            value={extPhone}
            onChange={(e) => setExtPhone(e.target.value)}
            type="tel"
            placeholder="+1 phone number"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <textarea
            value={extBody}
            onChange={(e) => setExtBody(e.target.value)}
            placeholder="Message (keep concise for SMS)…"
            rows={3}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={extListingId}
            onChange={(e) => setExtListingId(e.target.value)}
            placeholder="Related listing ID (optional)"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={
              sending ||
              !extPhone.trim() ||
              !extBody.trim() ||
              !PHONE_RE.test(extPhone.trim()) ||
              Boolean(extCaps && extCaps.sms_delivery_mode === "unconfigured")
            }
            className="w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            onClick={() => void onSendExternalSms()}
          >
            {sending ? "Sending…" : "Send text"}
          </button>
        </div>
      )}
      {extHistory.length > 0 ? (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <p className="text-[10px] font-semibold uppercase text-slate-500">Recent external outreach</p>
          <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto text-[11px] text-slate-600">
            {extHistory.slice(0, 5).map((row) => (
              <li key={row.id} className="truncate rounded bg-white px-2 py-1 ring-1 ring-slate-100">
                <span className="font-medium text-slate-800">{row.contact_method.toUpperCase()}</span> ·{" "}
                {row.recipient_email || row.recipient_phone || "—"} ·{" "}
                <span className="text-slate-500">{row.status}</span> · {new Date(row.created_at).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  const newGroupModal =
    newGroupOpen ? (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
      >
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <h3 id="new-group-title" className="text-sm font-semibold text-slate-900">
            New group chat
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            You will be the owner. Add people from the member list after the group opens.
          </p>
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            maxLength={120}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setNewGroupOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={newGroupBusy || !newGroupName.trim()}
              className="rounded-md bg-teal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              onClick={() => void onCreateGroupSubmit()}
            >
              {newGroupBusy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (variant === "drawer") {
    return (
      <>
        {newGroupModal}
        <div className="flex h-full min-h-0 flex-col" data-testid="messages-drawer-workspace">
        {error ? <p className="shrink-0 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex min-h-0 w-full flex-col border-b border-slate-100 md:w-[42%] md:border-b-0 md:border-r">
            {inboxSection}
            {composeSection}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{threadView}</div>
        </div>
      </div>
      </>
    );
  }

  if (variant === "sidebar") {
    return (
      <>
        {newGroupModal}
        <aside
        className="flex w-full min-w-0 flex-col border-l border-slate-200 bg-white shadow-sm lg:max-w-[min(100%,920px)] lg:shrink-0 lg:flex-row"
        data-testid="messages-sidebar-panel"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-200 lg:max-w-sm lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-slate-100 px-4 py-3">
            <h2 className="font-serif text-lg text-slate-900">Messages</h2>
            <p className="text-xs text-slate-600">Conversations and outreach while you browse the board.</p>
          </div>
          {error ? <p className="mx-3 mt-2 text-xs text-rose-700">{error}</p> : null}
          <div className="flex min-h-0 max-h-[40vh] flex-1 flex-col overflow-hidden lg:max-h-[calc(100vh-8rem)]">
            {inboxSection}
          </div>
          <div className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-slate-100 lg:max-h-none">{composeSection}</div>
        </div>
        <div className="flex min-h-[min(50vh,28rem)] min-w-0 flex-1 flex-col lg:min-h-[calc(100vh-10rem)]">
          {threadView}
        </div>
      </aside>
      </>
    );
  }

  return (
    <>
      {newGroupModal}
    <div
      className="flex min-h-[70vh] w-full flex-col border border-slate-200 bg-white shadow-sm md:flex-row"
      data-testid="messages-workspace-page"
    >
      <div className="flex w-full flex-col border-b border-slate-200 md:w-72 md:border-b-0 md:border-r">
        <div className="border-b border-slate-100 px-4 py-3">
          <h1 className="text-lg font-semibold">Messages</h1>
          <Link href="/community" className="text-xs text-teal-700 hover:underline">
            Community board
          </Link>
        </div>
        {inboxSection}
        {composeSection}
      </div>
      <div className="flex min-h-[50vh] flex-1 flex-col">
        {error ? <p className="p-3 text-sm text-rose-700">{error}</p> : null}
        {threadView}
      </div>
    </div>
    </>
  );
}
