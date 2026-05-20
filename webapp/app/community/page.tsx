"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { MessagesWorkspace } from "@/components/messaging/MessagesWorkspace";
import {
  createCommunityPost,
  fetchCommunityPostsPage,
  mediaUploadTokenized,
  voteCommunityPost,
  type CommunityPostSummary,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { OCH_MESSENGER_PREFILL_EVENT, type OchMessengerPrefillDetail } from "@/lib/messenger-events";
import { resolveCommunityImageUrl } from "@/lib/media-url";
import { formatAtUsername, formatUserDisplayName } from "@/lib/user-display";

const FLAIRS = ["", "landlord", "renter", "announcement", "general"] as const;

function flairPillClass(flair: string): string {
  const f = flair.toLowerCase();
  if (f === "landlord") return "bg-emerald-100 text-emerald-900";
  if (f === "renter") return "bg-sky-100 text-sky-900";
  if (f === "announcement") return "bg-amber-100 text-amber-950";
  return "bg-slate-100 text-slate-700";
}

export default function CommunityPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [posts, setPosts] = useState<CommunityPostSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [flair, setFlair] = useState<string>("");
  const [searchDraft, setSearchDraft] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newFlair, setNewFlair] = useState("general");
  const [newImages, setNewImages] = useState<Array<{ url: string; alt?: string | null }>>([]);
  const [creating, setCreating] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messengerPrefill, setMessengerPrefill] = useState<{ recipientUuid: string; subject: string } | null>(null);
  const [feedVoteBusy, setFeedVoteBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = getStoredToken();
      const data = await fetchCommunityPostsPage({
        page: 1,
        pageSize: 24,
        q: q.trim() || undefined,
        flair: flair || undefined,
        token: token ?? undefined,
      });
      setPosts(data.posts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load community posts.");
    }
  }, [q, flair]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEmail(getStoredEmail());
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    const onPrefill = (ev: Event) => {
      const ce = ev as CustomEvent<OchMessengerPrefillDetail>;
      const d = ce.detail ?? {};
      const recipientUuid = String(d.recipientUuid ?? "").trim();
      const subject = String(d.subject ?? "").trim();
      if (recipientUuid || subject) {
        setMessengerPrefill({ recipientUuid, subject });
      }
      setMessagesOpen(true);
    };
    window.addEventListener(OCH_MESSENGER_PREFILL_EVENT, onPrefill as EventListener);
    return () => window.removeEventListener(OCH_MESSENGER_PREFILL_EVENT, onPrefill as EventListener);
  }, []);

  async function onFeedPostVote(postId: string, value: 1 | -1) {
    const t = getStoredToken();
    if (!t || feedVoteBusy) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    setFeedVoteBusy(postId);
    setError(null);
    try {
      const cur = post.yourVote === 1 || post.yourVote === -1 ? post.yourVote : null;
      const next: -1 | 0 | 1 = cur === value ? 0 : value;
      const out = await voteCommunityPost(t, postId, next);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, voteCount: out.voteCount, yourVote: out.yourVote } : p,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setFeedVoteBusy(null);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const t = getStoredToken();
    if (!t || !newTitle.trim() || !newBody.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createCommunityPost(t, {
        title: newTitle.trim(),
        body: newBody.trim(),
        flair: newFlair,
        images: newImages,
      });
      setNewTitle("");
      setNewBody("");
      setNewFlair("general");
      setNewImages([]);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const t = getStoredToken();
    const files = Array.from(e.target.files ?? []);
    if (!t || files.length === 0) return;
    setCreating(true);
    try {
      const uploaded: Array<{ url: string; alt?: string | null }> = [];
      for (const f of files.slice(0, 8)) {
        const r = await mediaUploadTokenized(t, f);
        uploaded.push({ url: r.url, alt: f.name || null });
      }
      setNewImages((prev) => [...prev, ...uploaded].slice(0, 8));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setCreating(false);
      e.target.value = "";
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Nav email={email} />
      <div className="relative mx-auto max-w-[1400px] px-4 py-8">
        <main className="min-w-0 space-y-6">
          <header>
            <h1 className="font-serif text-3xl tracking-tight text-slate-900 md:text-4xl">Community board</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 md:text-base">
              Reddit-style housing feed for promotions, requests, and public service announcements. Landlords and
              renters can both post what they need, then continue in direct messages.
            </p>
          </header>

          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[12rem] flex-1">
              <label className="text-xs font-semibold uppercase text-slate-500">Search posts</label>
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQ(searchDraft);
                }}
                placeholder="Title or body…"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">Flair</label>
              <select
                value={flair}
                onChange={(e) => setFlair(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-44"
              >
                {FLAIRS.map((f) => (
                  <option key={f || "all"} value={f}>
                    {f ? f : "All"}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
              onClick={() => setQ(searchDraft)}
            >
              Search
            </button>
          </div>

          {error ? (
            <p
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              data-testid="community-error"
            >
              {error}
            </p>
          ) : null}

          {hasToken ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">New post</h2>
              <form onSubmit={(e) => void onCreate(e)} className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-3">
                  <select
                    value={newFlair}
                    onChange={(e) => setNewFlair(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {FLAIRS.filter(Boolean).map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Body"
                  rows={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="space-y-2">
                  <input type="file" accept="image/*" multiple onChange={onImagePick} className="text-sm" />
                  {newImages.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {newImages.map((img, idx) => (
                        <li key={`${img.url}-${idx}`} className="relative overflow-hidden rounded border">
                          <img
                            src={resolveCommunityImageUrl(img.url)}
                            alt={img.alt || "Community upload"}
                            className="h-24 w-full object-cover"
                          />
                          <button
                            type="button"
                            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
                            onClick={() => setNewImages((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={creating || !newTitle.trim() || !newBody.trim()}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
                >
                  {creating ? "Posting…" : "Publish"}
                </button>
              </form>
            </section>
          ) : (
            <p className="text-sm text-slate-600">
              <Link href="/login" className="font-medium text-teal-700 hover:underline">
                Sign in
              </Link>{" "}
              to publish posts.
            </p>
          )}

          <div
            className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-testid="community-post-grid"
          >
            {posts.map((post) => (
              <div
                key={post.id}
                data-testid={`community-post-${post.id}`}
                className="flex w-[min(100%,280px)] shrink-0 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/30"
              >
                <Link href={`/community/${post.id}`} className="block min-h-0 flex-1">
                  <span
                    className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${flairPillClass(post.flair || "general")}`}
                  >
                    {post.flair || "general"}
                  </span>
                  <h2 className="mt-2 font-semibold leading-snug text-slate-900">{post.title}</h2>
                  {(post.images?.[0]?.url ?? "").trim() ? (
                    <img
                      src={resolveCommunityImageUrl(post.images?.[0]?.url)}
                      alt={post.images?.[0]?.alt || post.title}
                      className="mt-2 h-28 w-full rounded object-cover"
                    />
                  ) : null}
                  <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                    {(post.body || "").slice(0, 200)}
                    {(post.body || "").length > 200 ? "…" : ""}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-700">
                    {formatUserDisplayName(post.author_display_name, post.author_username)}
                    {post.author_username ? (
                      <span className="font-normal text-slate-500"> {formatAtUsername(post.author_username)}</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {post.commentCount} comments · {post.voteCount} votes
                  </p>
                </Link>
                {hasToken ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      disabled={feedVoteBusy === post.id}
                      aria-label="Upvote post"
                      onClick={(e) => {
                        e.preventDefault();
                        void onFeedPostVote(post.id, 1);
                      }}
                      className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                        post.yourVote === 1
                          ? "border-teal-700 bg-teal-50 text-teal-900"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      ▲
                    </button>
                    <span className="text-xs tabular-nums text-slate-600">{post.voteCount}</span>
                    <button
                      type="button"
                      disabled={feedVoteBusy === post.id}
                      aria-label="Downvote post"
                      onClick={(e) => {
                        e.preventDefault();
                        void onFeedPostVote(post.id, -1);
                      }}
                      className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                        post.yourVote === -1
                          ? "border-rose-600 bg-rose-50 text-rose-900"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      ▼
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </main>

        <button
          type="button"
          data-testid="community-messages-toggle"
          className="fixed bottom-5 right-5 z-40 rounded-full bg-teal-800 px-4 py-3 text-sm font-semibold text-white shadow-lg ring-2 ring-white/80 hover:bg-teal-700 md:bottom-8 md:right-8"
          onClick={() => setMessagesOpen((v) => !v)}
          aria-expanded={messagesOpen}
        >
          Messages
        </button>

        {messagesOpen ? (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Messages">
            <button
              type="button"
              className="absolute inset-0 bg-black/30"
              aria-label="Close messages"
              onClick={() => {
                setMessagesOpen(false);
                setMessengerPrefill(null);
              }}
            />
            <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <p className="text-sm font-semibold text-slate-900">Messages</p>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                  onClick={() => {
                    setMessagesOpen(false);
                    setMessengerPrefill(null);
                  }}
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <MessagesWorkspace
                  variant="drawer"
                  prefillRecipient={messengerPrefill?.recipientUuid ?? null}
                  prefillSubject={messengerPrefill?.subject ?? null}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
