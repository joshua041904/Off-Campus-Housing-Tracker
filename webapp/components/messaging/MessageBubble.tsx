"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatUserDisplayName } from "@/lib/user-display";
import { prettyMessagePreview } from "@/lib/listing-display";
import { EmojiPickerPanel } from "@/components/messaging/EmojiPickerPanel";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"] as const;

export type BubbleThreadMsg = {
  id?: string;
  sender_id?: string;
  content?: string;
  message_type?: string;
  created_at?: string;
  updated_at?: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  recalled_at?: string | null;
  sender_username?: string;
  sender_display_name?: string | null;
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

type MessageBubbleProps = {
  m: BubbleThreadMsg;
  mine: boolean;
  isSystem: boolean;
  reactionBusy: string | null;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (m: BubbleThreadMsg) => void;
  onEdit: (m: BubbleThreadMsg) => void;
  /** Soft-delete for everyone (sender only). */
  onDeleteForEveryone?: (m: BubbleThreadMsg) => void;
  /** Hide this message from my thread view only. */
  onHideForMe: (m: BubbleThreadMsg) => void;
  onJumpToReplyTarget?: (messageId: string) => void;
  /** When set, this bubble shows inline editor */
  editing: boolean;
  editDraft: string;
  onEditDraft: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  editSaving: boolean;
};

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

function formatSender(m: BubbleThreadMsg): string {
  return formatUserDisplayName(m.sender_display_name, m.sender_username);
}

export function MessageBubble({
  m,
  mine,
  isSystem,
  reactionBusy,
  onToggleReaction,
  onReply,
  onEdit,
  onDeleteForEveryone,
  onHideForMe,
  onJumpToReplyTarget,
  editing,
  editDraft,
  onEditDraft,
  onSaveEdit,
  onCancelEdit,
  editSaving,
}: MessageBubbleProps) {
  const mid = String(m.id || "");
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stickActions, setStickActions] = useState(false);
  const reactions = m.reactions ?? [];

  const recalledMsg = Boolean(m.recalled_at) || String(m.content || "").includes("[Message recalled]");
  const softRemoved = Boolean(m.deleted_at) && !recalledMsg;
  const placeholder = softRemoved || recalledMsg;
  const reactionLocked = placeholder;

  useEffect(() => {
    if (!pickerOpen && !stickActions) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (!el || !(ev.target instanceof Node) || el.contains(ev.target)) return;
      setPickerOpen(false);
      setStickActions(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen, stickActions]);

  const closeAll = useCallback(() => {
    setPickerOpen(false);
    setStickActions(false);
  }, []);

  if (isSystem) {
    return (
      <div className="max-w-[92%] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {m.content}
      </div>
    );
  }

  const openActions = stickActions || pickerOpen;

  return (
    <div
      ref={wrapRef}
      className={`group/bub relative flex max-w-[min(100%,28rem)] flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}
    >
      {!placeholder ? (
        <span
          className={`text-[11px] font-medium text-slate-500 ${mine ? "self-end text-right" : "text-left"}`}
        >
          {mine ? "You" : formatSender(m)}
        </span>
      ) : null}

      <div
        className={`relative ${reactions.length > 0 ? "pb-2" : "pb-0.5"} ${mine ? "ml-4" : "mr-4"}`}
        onMouseEnter={() => {
          if (!editing && !placeholder) setStickActions(true);
        }}
        onMouseLeave={() => {
          if (!pickerOpen) setStickActions(false);
        }}
        onClick={(ev) => {
          if (placeholder || editing) return;
          const el = ev.target as HTMLElement;
          if (el.closest("button") || el.closest("textarea")) return;
          setStickActions((s) => !s);
        }}
      >
        {!editing && !placeholder ? (
          <div
            className={`pointer-events-none absolute -top-1 z-30 flex gap-0.5 opacity-0 transition group-hover/bub:pointer-events-auto group-hover/bub:opacity-100 ${openActions ? "pointer-events-auto opacity-100" : ""}`}
            style={mine ? { right: 0, transform: "translateY(-100%)" } : { left: 0, transform: "translateY(-100%)" }}
          >
            <div className="pointer-events-auto flex rounded-full border border-slate-200/90 bg-white/98 px-0.5 py-0.5 shadow-md backdrop-blur-sm">
              <button
                type="button"
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                aria-expanded={pickerOpen}
                aria-controls={`${menuId}-picker`}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerOpen((v) => !v);
                  setStickActions(true);
                }}
              >
                React
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onReply(m);
                  closeAll();
                }}
              >
                Reply
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideForMe(m);
                  closeAll();
                }}
              >
                Hide
              </button>
              {mine ? (
                <>
                  <button
                    type="button"
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(m);
                      closeAll();
                    }}
                  >
                    Edit
                  </button>
                  {onDeleteForEveryone ? (
                    <button
                      type="button"
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteForEveryone(m);
                        closeAll();
                      }}
                    >
                      For all
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {placeholder ? (
          <div
            className={`inline-flex max-w-[min(100%,18rem)] items-center rounded-md border px-2 py-0.5 text-[10px] leading-snug text-slate-500 shadow-none ${
              recalledMsg ? "border-amber-200/70 bg-amber-50/80 text-amber-900/85" : "border-slate-200/80 bg-slate-50/90"
            }`}
          >
            <span className="opacity-90">{recalledMsg ? "Message unsent" : "Message removed"}</span>
          </div>
        ) : (
          <div
            className={`message-bubble rounded-2xl px-3 py-2 text-left text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere] [word-break:normal] ${
              mine ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-900"
            }`}
          >
            {m.reply_to_message?.content_snippet ? (
              <button
                type="button"
                className={`mb-1.5 w-full rounded-lg border px-2 py-1 text-left text-[11px] leading-snug transition ${
                  mine
                    ? "border-white/35 bg-black/18 text-white hover:bg-black/28"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
                onClick={() => {
                  const tid = m.reply_to_message?.id;
                  if (tid && onJumpToReplyTarget) onJumpToReplyTarget(String(tid));
                }}
              >
                <span className="line-clamp-2 font-medium opacity-95">
                  {prettyMessagePreview(String(m.reply_to_message.content_snippet || ""))}
                </span>
              </button>
            ) : null}

            {editing ? (
              <div className="space-y-2 text-left" onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={editDraft}
                  onChange={(e) => onEditDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={editSaving || !editDraft.trim()}
                    className="rounded bg-teal-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                    onClick={() => void onSaveEdit()}
                  >
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="rounded border px-2 py-1 text-xs" onClick={onCancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words text-left [overflow-wrap:anywhere] [word-break:normal]">
                {m.content}
              </p>
            )}
          </div>
        )}

        {reactions.length > 0 ? (
          <div
            className={`absolute z-20 flex max-w-[calc(100%-0.5rem)] flex-wrap gap-0.5 ${mine ? "right-2 justify-end" : "left-2 justify-start"}`}
            style={{ bottom: 0, transform: "translateY(50%)" }}
          >
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={Boolean(reactionBusy) || !mid || reactionLocked}
                title={r.includes_me ? "Tap to remove your reaction" : "Tap to add this reaction"}
                className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none shadow-md transition disabled:opacity-40 ${
                  r.includes_me
                    ? "border-teal-300 bg-teal-50 text-teal-900"
                    : "border-slate-200/95 bg-white text-slate-800 hover:bg-slate-50"
                }`}
                onClick={() => void onToggleReaction(mid, r.emoji)}
              >
                <span>{r.emoji}</span>
                <span className="text-[10px] font-semibold opacity-80">{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {pickerOpen && !editing && !placeholder ? (
          <div
            id={`${menuId}-picker`}
            className="absolute z-40 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg"
            style={mine ? { right: 0, top: "100%" } : { left: 0, top: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-2 py-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Quick tap</p>
              <div className="flex flex-wrap gap-1">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    disabled={Boolean(reactionBusy) || !mid}
                    className="rounded-md bg-slate-100 px-2 py-1 text-sm hover:bg-slate-200 disabled:opacity-40"
                    onClick={() => {
                      void onToggleReaction(mid, e);
                      setPickerOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <EmojiPickerPanel
              onEmojiClick={(emoji) => {
                void onToggleReaction(mid, emoji);
                setPickerOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      <div
        className={`mt-1 flex flex-wrap items-center gap-2 text-[10px] ${mine ? "justify-end text-slate-400" : "justify-start text-slate-400"}`}
      >
        {m.created_at ? <span>{formatMessageTime(m.created_at)}</span> : null}
        {m.edited_at && !placeholder ? (
          <span className="text-slate-500" title={m.updated_at ? formatMessageTime(m.updated_at) : undefined}>
            Edited
          </span>
        ) : null}
      </div>
    </div>
  );
}
