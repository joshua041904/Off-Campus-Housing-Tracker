"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MessagesWorkspace } from "@/components/messaging/MessagesWorkspace";
import {
  OCH_MESSENGER_PREFILL_EVENT,
  type OchMessengerPrefillDetail,
} from "@/lib/messenger-events";

/**
 * Floating messages entry on all routes except `/community/*` (that page has its own slide-over drawer).
 */
export function GlobalMessageDock() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ recipientUuid: string; subject: string } | null>(null);

  const hidden = pathname === "/community" || pathname.startsWith("/community/");

  const applyPrefill = useCallback((d: OchMessengerPrefillDetail) => {
    const recipientUuid = String(d.recipientUuid ?? "").trim();
    const subject = String(d.subject ?? "").trim();
    if (recipientUuid || subject) {
      setPrefill({ recipientUuid, subject });
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    const onPrefill = (ev: Event) => {
      const ce = ev as CustomEvent<OchMessengerPrefillDetail>;
      applyPrefill(ce.detail ?? {});
    };
    window.addEventListener(OCH_MESSENGER_PREFILL_EVENT, onPrefill as EventListener);
    return () => window.removeEventListener(OCH_MESSENGER_PREFILL_EVENT, onPrefill as EventListener);
  }, [applyPrefill]);

  useEffect(() => {
    const dm = searchParams?.get("och_dm")?.trim();
    if (!dm) return;
    applyPrefill({ recipientUuid: dm, subject: "" });
  }, [searchParams, applyPrefill]);

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        data-testid="global-messages-toggle"
        className="fixed bottom-5 right-5 z-40 rounded-full bg-teal-800 px-4 py-3 text-sm font-semibold text-white shadow-lg ring-2 ring-white/80 hover:bg-teal-700 md:bottom-8 md:right-8"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Messages
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Messages">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close messages"
            onClick={() => {
              setOpen(false);
              setPrefill(null);
            }}
          />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <p className="text-sm font-semibold text-slate-900">Messages</p>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => {
                  setOpen(false);
                  setPrefill(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessagesWorkspace
                variant="drawer"
                prefillRecipient={prefill?.recipientUuid ?? null}
                prefillSubject={prefill?.subject ?? null}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
