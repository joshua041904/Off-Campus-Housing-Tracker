"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { MessagesWorkspace } from "@/components/messaging/MessagesWorkspace";
import { getStoredEmail } from "@/lib/auth-storage";

const THREAD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function MessagesMain() {
  const searchParams = useSearchParams();
  const compose = searchParams.get("compose");
  const to = searchParams.get("to");
  const rawThread = searchParams.get("thread");
  const initialThreadId =
    rawThread && THREAD_UUID_RE.test(rawThread.trim()) ? rawThread.trim() : null;
  const initialComposeChannel =
    compose === "external" || compose === "email" ? "email" : compose === "sms" ? "sms" : "och";

  return (
    <MessagesWorkspace
      variant="page"
      initialThreadId={initialThreadId}
      initialComposeChannel={initialComposeChannel}
      prefillRecipient={to?.trim() || null}
    />
  );
}

export default function MessagesPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(getStoredEmail());
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Suspense fallback={<p className="text-sm text-slate-600">Loading messages…</p>}>
          <MessagesMain />
        </Suspense>
      </main>
    </div>
  );
}
