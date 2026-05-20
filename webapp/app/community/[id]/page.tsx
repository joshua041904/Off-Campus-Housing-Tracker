"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityComments,
  fetchCommunityPost,
  markNotificationRead,
  postCommunityComment,
  voteCommunityComment,
  voteCommunityPost,
  type CommunityComment,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { resolveCommunityImageUrl } from "@/lib/media-url";
import { OCH_MESSENGER_PREFILL_EVENT } from "@/lib/messenger-events";
import { scrubCommunityBody } from "@/lib/listing-display";
import { formatAtUsername, formatUserDisplayName } from "@/lib/user-display";

type CommentBranchProps = {
  comment: CommunityComment;
  depth: number;
  repliesByParentId: Map<string, CommunityComment[]>;
  hasToken: boolean;
  myUserId: string | null;
  voteBusyKey: string | null;
  onVote: (commentId: string, value: 1 | -1) => void;
  onReply: (commentId: string) => void;
  onDelete: (commentId: string) => void;
};

/** Renders one comment and all descendants (arbitrary depth). */
function CommentBranch({
  comment: c,
  depth,
  repliesByParentId,
  hasToken,
  myUserId,
  voteBusyKey,
  onVote,
  onReply,
  onDelete,
}: CommentBranchProps) {
  const children = repliesByParentId.get(c.id) ?? [];
  const isNested = depth > 0;
  return (
    <li
      id={`community-comment-${c.id}`}
      className={`text-sm ${isNested ? "" : "border-b border-slate-100 pb-3 last:border-0"}`}
    >
      <p className="text-xs text-slate-500">
        <span className="font-medium text-slate-700">
          {formatUserDisplayName(c.author_display_name, c.author_username)}
        </span>
        {c.author_username ? <span className="text-slate-500"> {formatAtUsername(c.author_username)}</span> : null}{" "}
        · {new Date(c.created_at).toLocaleString()}
      </p>
      <p className="mt-1 text-slate-800">{c.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {hasToken ? (
          <>
            <button
              type="button"
              disabled={voteBusyKey === `c:${c.id}`}
              aria-label="Upvote comment"
              onClick={() => onVote(c.id, 1)}
              className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                c.yourVote === 1 ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              ▲
            </button>
            <span className="text-xs tabular-nums text-slate-600">{c.voteCount ?? 0}</span>
            <button
              type="button"
              disabled={voteBusyKey === `c:${c.id}`}
              aria-label="Downvote comment"
              onClick={() => onVote(c.id, -1)}
              className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                c.yourVote === -1 ? "border-rose-600 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              ▼
            </button>
            <button
              type="button"
              className="text-[11px] font-medium text-teal-700 hover:underline"
              onClick={() => onReply(c.id)}
            >
              Reply
            </button>
            {myUserId && c.author_id === myUserId ? (
              <button
                type="button"
                className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                onClick={() => void onDelete(c.id)}
              >
                Delete
              </button>
            ) : null}
          </>
        ) : (
          <span className="text-[11px] text-slate-500">{c.voteCount ?? 0} votes</span>
        )}
      </div>
      {children.length > 0 ? (
        <ul className="mt-3 space-y-3 border-l-2 border-teal-100 pl-3">
          {children.map((ch) => (
            <CommentBranch
              key={ch.id}
              comment={ch}
              depth={depth + 1}
              repliesByParentId={repliesByParentId}
              hasToken={hasToken}
              myUserId={myUserId}
              voteBusyKey={voteBusyKey}
              onVote={onVote}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function CommunityPostDetailPage() {
  const params = useParams<{ id: string }>();
  const postId = params?.id || "";
  const [email, setEmail] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [authorDisplayName, setAuthorDisplayName] = useState<string | null>(null);
  const [authorUsername, setAuthorUsername] = useState<string | null>(null);
  const [flair, setFlair] = useState("general");
  const [images, setImages] = useState<Array<{ url: string; alt?: string | null }>>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [postVoteTotal, setPostVoteTotal] = useState(0);
  const [postYourVote, setPostYourVote] = useState<number | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  /** `"post"` or `"c:" + commentId` so comment votes do not block each other or the post row. */
  const [voteBusyKey, setVoteBusyKey] = useState<string | null>(null);
  const [queryNid, setQueryNid] = useState("");
  const [highlightCommentId, setHighlightCommentId] = useState("");

  const { topLevelComments, repliesByParentId } = useMemo(() => {
    const roots: CommunityComment[] = [];
    const replies = new Map<string, CommunityComment[]>();
    for (const c of comments) {
      const pid = c.parent_comment_id != null ? String(c.parent_comment_id).trim() : "";
      if (!pid) roots.push(c);
      else {
        const arr = replies.get(pid) ?? [];
        arr.push(c);
        replies.set(pid, arr);
      }
    }
    const byTime = (a: CommunityComment, b: CommunityComment) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    roots.sort(byTime);
    replies.forEach((arr) => {
      arr.sort(byTime);
    });
    return { topLevelComments: roots, repliesByParentId: replies };
  }, [comments]);

  const load = useCallback(async () => {
    if (!postId) return;
    setError(null);
    try {
      const token = getStoredToken();
      const [p, c] = await Promise.all([
        fetchCommunityPost(postId, token),
        fetchCommunityComments(postId, token),
      ]);
      setTitle(p.title);
      setBody(p.body);
      setAuthorId(p.author_id);
      setAuthorDisplayName(p.author_display_name);
      setAuthorUsername(p.author_username);
      setFlair(p.flair);
      setImages(p.images ?? []);
      setCommentCount(p.commentCount);
      setPostVoteTotal(p.voteCount);
      setPostYourVote(p.yourVote);
      setComments(c.comments);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load post.");
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEmail(getStoredEmail());
    const t = getStoredToken();
    setHasToken(!!t);
    setMyUserId(getSubFromJwt(t));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    setQueryNid(String(sp.get("nid") || "").trim());
    setHighlightCommentId(String(sp.get("comment") || "").trim());
  }, [postId]);

  useEffect(() => {
    if (!highlightCommentId) return;
    const t = window.setTimeout(() => {
      document.getElementById(`community-comment-${highlightCommentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [highlightCommentId, comments]);

  useEffect(() => {
    const t = getStoredToken();
    if (!queryNid || !t) return;
    void markNotificationRead(t, queryNid).catch(() => {});
    try {
      window.dispatchEvent(new CustomEvent("och:badges-refresh"));
    } catch {
      /* ignore */
    }
  }, [queryNid, postId]);

  async function onPostVote(value: 1 | -1) {
    const t = getStoredToken();
    if (!t || voteBusyKey === "post") return;
    setVoteBusyKey("post");
    setError(null);
    try {
      const next: -1 | 0 | 1 = postYourVote === value ? 0 : value;
      const out = await voteCommunityPost(t, postId, next);
      setPostVoteTotal(out.voteCount);
      setPostYourVote(out.yourVote);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setVoteBusyKey(null);
    }
  }

  async function handleDeleteComment(commentId: string) {
    const t = getStoredToken();
    if (!t) return;
    setError(null);
    try {
      await deleteCommunityComment(t, postId, commentId);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function onCommentVote(commentId: string, value: 1 | -1) {
    const t = getStoredToken();
    const key = `c:${commentId}`;
    if (!t || voteBusyKey === key) return;
    setVoteBusyKey(key);
    setError(null);
    try {
      const cur = comments.find((c) => c.id === commentId)?.yourVote;
      const next: -1 | 0 | 1 = cur === value ? 0 : value;
      const out = await voteCommunityComment(t, postId, commentId, next);
      setComments((prev) =>
        prev.map((x) =>
          x.id === commentId ? { ...x, voteCount: out.voteCount, yourVote: out.yourVote } : x,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setVoteBusyKey(null);
    }
  }

  async function onComment(e: React.FormEvent) {
    e.preventDefault();
    const t = getStoredToken();
    if (!t || !commentBody.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await postCommunityComment(t, postId, commentBody.trim(), replyToId);
      setCommentBody("");
      setReplyToId(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <Link href="/community" className="text-sm font-medium text-teal-700 hover:text-teal-600">
          ← Back to community
        </Link>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
            {flair}
          </span>
          <h1 className="mt-2 text-2xl font-semibold">{title || "…"}</h1>
          <p className="mt-2 text-sm text-slate-600">
            By{" "}
            <span className="font-medium text-slate-900">
              {formatUserDisplayName(authorDisplayName, authorUsername)}
            </span>
            {authorUsername ? (
              <span className="text-slate-500"> {formatAtUsername(authorUsername)}</span>
            ) : null}{" "}
            · {commentCount} comments · {postVoteTotal} votes
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasToken ? (
              <>
                <button
                  type="button"
                  disabled={voteBusyKey === "post"}
                  aria-label="Upvote post"
                  onClick={() => void onPostVote(1)}
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                    postYourVote === 1 ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={voteBusyKey === "post"}
                  aria-label="Downvote post"
                  onClick={() => void onPostVote(-1)}
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                    postYourVote === -1 ? "border-rose-600 bg-rose-50 text-rose-900" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  ▼
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Sign in to vote on this post.</span>
            )}
          </div>
          {hasToken && authorId ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent(OCH_MESSENGER_PREFILL_EVENT, {
                      detail: {
                        recipientUuid: authorId,
                      },
                    }),
                  );
                }}
              >
                Message in OCH
              </button>
              {myUserId && myUserId === authorId ? (
                <button
                  type="button"
                  className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
                  onClick={async () => {
                    const t = getStoredToken();
                    if (!t) return;
                    setError(null);
                    try {
                      await deleteCommunityPost(t, postId);
                      window.location.href = "/community";
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : "Delete failed");
                    }
                  }}
                >
                  Delete post
                </button>
              ) : null}
            </div>
          ) : null}
          {images.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {images.map((img, idx) => (
                <img
                  key={`${img.url}-${idx}`}
                  src={resolveCommunityImageUrl(img.url)}
                  alt={img.alt || `Community image ${idx + 1}`}
                  className="h-52 w-full rounded border object-cover"
                />
              ))}
            </div>
          ) : null}
          <div className="prose prose-slate mt-6 max-w-none whitespace-pre-wrap text-slate-800">{scrubCommunityBody(body) || "…"}</div>
        </article>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Comments</h2>
          <ul className="mt-4 space-y-3">
            {comments.length === 0 ? (
              <li className="text-sm text-slate-500">No comments yet.</li>
            ) : (
              topLevelComments.map((c) => (
                <CommentBranch
                  key={c.id}
                  comment={c}
                  depth={0}
                  repliesByParentId={repliesByParentId}
                  hasToken={hasToken}
                  myUserId={myUserId}
                  voteBusyKey={voteBusyKey}
                  onVote={(id, v) => void onCommentVote(id, v)}
                  onReply={setReplyToId}
                  onDelete={handleDeleteComment}
                />
              ))
            )}
          </ul>
          {hasToken ? (
            <form onSubmit={(e) => void onComment(e)} className="mt-4 space-y-2">
              {replyToId ? (
                <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50/80 px-3 py-2 text-xs text-teal-900">
                  <span className="line-clamp-2 pr-2">
                    Replying to:{" "}
                    <span className="font-medium text-slate-800">
                      {(comments.find((x) => x.id === replyToId)?.body || "").trim().slice(0, 120) ||
                        "selected comment"}
                    </span>
                  </span>
                  <button type="button" className="shrink-0 font-medium text-teal-800 hover:underline" onClick={() => setReplyToId(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder={replyToId ? "Write your reply…" : "Add a comment…"}
              />
              <button
                type="submit"
                disabled={posting || !commentBody.trim()}
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {posting ? "Posting…" : replyToId ? "Post reply" : "Post comment"}
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              <Link href="/login" className="text-teal-700 hover:underline">
                Sign in
              </Link>{" "}
              to comment.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
