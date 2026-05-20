"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { listMessagingExternalContacts, type ExternalContactHistoryRow } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";

export default function AccountExternalContactPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [history, setHistory] = useState<ExternalContactHistoryRow[]>([]);

  useEffect(() => {
    const t = getStoredToken();
    const em = getStoredEmail();
    if (!t) {
      if (typeof window !== "undefined") window.location.replace("/login");
      return;
    }
    setToken(t);
    setEmail(em);
    void listMessagingExternalContacts(t, 100).then(setHistory).catch(() => setHistory([]));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-16">
      <Nav email={email} />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6">
          <Link href="/dashboard" className="text-sm font-medium text-teal-700 hover:underline">
            ← Dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Use{" "}
          <Link href="/dashboard/messages?compose=external" className="font-medium text-teal-800 hover:underline">
            Messages → Email / SMS
          </Link>{" "}
          to attempt real outbound delivery (SMTP or SMS transport). History lists each attempt with status (sent,
          failed, dev_mock) and never creates an in-app DM thread.
        </p>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">External contact history</h2>
          <p className="text-xs text-slate-600">Rows reflect server-sent outreach (not in-app chat).</p>
          {!token ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : history.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No external contact history yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {history.map((row) => (
                <li key={row.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">
                    {row.contact_method.toUpperCase()} · {row.recipient_email || row.recipient_phone || "Recipient"}
                  </p>
                  {row.subject ? <p className="text-xs text-slate-700">Subject: {row.subject}</p> : null}
                  <p className="line-clamp-2 text-xs text-slate-600">{row.body}</p>
                  <p className="text-[11px] text-slate-500">
                    Status: <span className="font-medium text-slate-700">{row.status}</span>
                    {row.delivery_error ? (
                      <span className="text-rose-700"> · {row.delivery_error}</span>
                    ) : null}
                    {" · "}
                    {new Date(row.created_at).toLocaleString()}
                    {row.sent_at ? ` · sent: ${new Date(row.sent_at).toLocaleString()}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
