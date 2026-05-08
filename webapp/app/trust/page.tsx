"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getReputation, reportAbuse, submitPeerReview } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";

const TrustHeaderSection = memo(function TrustHeaderSection() {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Trust & safety
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
        Manage trust, safety, and reputation
      </h1>
      <p className="mt-4 text-lg leading-8 text-slate-600">
        Report abuse, submit peer reviews, and look up user reputation. These
        tools help maintain a safe and trustworthy housing community.
      </p>
    </section>
  );
});
TrustHeaderSection.displayName = "TrustHeaderSection";

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200 ${className}`}
    />
  );
}

function ReputationSkeleton() {
  return (
    <div
      data-testid="trust-reputation-skeleton"
      className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4"
      aria-hidden="true"
    >
      <SkeletonLine className="h-4 w-32" />

      <SkeletonLine className="mt-3 h-7 w-24" />

      <SkeletonLine className="mt-3 h-3 w-48" />
    </div>
  );
}

function ReputationSection({
  repUserId,
  setRepUserId,
  onReputation,
  loading,
  mySub,
  repScore,
  repError,
}: {
  repUserId: string;
  setRepUserId: React.Dispatch<React.SetStateAction<string>>;
  onReputation: (e: React.FormEvent) => Promise<void>;
  loading: boolean;
  mySub: string | null;
  repScore: number | null;
  repError: string | null;
}) {
  return (
    <section className="mt-10 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Reputation
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Look up a user’s reputation
      </h2>
      <form
        data-testid="trust-reputation-form"
        onSubmit={onReputation}
        aria-busy={loading}
        className="mt-4 flex flex-col gap-3 sm:flex-row"
      >
        <label
          htmlFor="trust-reputation-user-id"
          className="sr-only"
        >
          User UUID
        </label>
        <input
          id="trust-reputation-user-id"
          data-testid="trust-reputation-user-id"
          value={repUserId}
          onChange={(e) => setRepUserId(e.target.value)}
          placeholder="user UUID"
          aria-describedby={repError ? "rep-error" : undefined}
          aria-invalid={repError ? true : undefined}
          className={"flex-1 rounded-md border px-3 py-2 font-mono text-sm text-slate-900 shadow-sm bg-white " + (repError ? "border-red-400" : "border-slate-300")}
        />
        <button
          type="submit"
          disabled={loading}
          aria-disabled={loading}
          data-testid="trust-reputation-submit"
          className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {loading ? "Looking up…" : "Look up"}
        </button>
      </form>
      {repError && (
        <p id="rep-error" role="alert" aria-live="assertive" className="mt-2 text-xs text-red-600">
          {repError}
        </p>
      )}
      {mySub && (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-teal-700 hover:underline"
          onClick={() => setRepUserId(mySub)}
        >
          Use my account id
        </button>
      )}
      {loading ? (
        <ReputationSkeleton />
      ) : (
        repScore != null && (
          <p
            data-testid="trust-reputation-score"
            className="mt-4 text-sm text-slate-600"
          >
            Score: <strong className="text-teal-800">{repScore}</strong>
          </p>
        )
      )}
    </section>
  );
});
ReputationSection.displayName = "ReputationSection";

const ReportAbuseSection = memo(function ReportAbuseSection({
  abuseType,
  setAbuseType,
  abuseTarget,
  setAbuseTarget,
  abuseCategory,
  setAbuseCategory,
  abuseDetails,
  setAbuseDetails,
  onReport,
  loading,
}: {
  abuseType: "listing" | "user";
  setAbuseType: React.Dispatch<React.SetStateAction<"listing" | "user">>;
  abuseTarget: string;
  setAbuseTarget: React.Dispatch<React.SetStateAction<string>>;
  abuseCategory: string;
  setAbuseCategory: React.Dispatch<React.SetStateAction<string>>;
  abuseDetails: string;
  setAbuseDetails: React.Dispatch<React.SetStateAction<string>>;
  onReport: (e: React.FormEvent) => Promise<void>;
  loading: boolean;
  abuseError: string | null;
}) {
  return (
    <section className="mt-10 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Moderation
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Report abuse
      </h2>
      <form
        onSubmit={onReport}
        aria-busy={loading}
        className="mt-4 space-y-3"
      >
        <fieldset className="flex gap-4 text-sm text-slate-700">
          <legend className="sr-only">Abuse target type</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="abuseType"
              checked={abuseType === "listing"}
              onChange={() => setAbuseType("listing")}
            />
            Listing
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="abuseType"
              checked={abuseType === "user"}
              onChange={() => setAbuseType("user")}
            />
            User
          </label>
        </fieldset>
        <label
          htmlFor="trust-abuse-target"
          className="sr-only"
        >
          Target UUID
        </label>
        <input
          id="trust-abuse-target"
          value={abuseTarget}
          onChange={(e) => setAbuseTarget(e.target.value)}
          placeholder="target UUID"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm"
          required
        />
        <label
          htmlFor="trust-abuse-category"
          className="sr-only"
        >
          Abuse category
        </label>
        <input
          id="trust-abuse-category"
          value={abuseCategory}
          onChange={(e) => setAbuseCategory(e.target.value)}
          placeholder="category"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
        />
        <label
          htmlFor="trust-abuse-details"
          className="sr-only"
        >
          Abuse details
        </label>
        <textarea
          id="trust-abuse-details"
          value={abuseDetails}
          onChange={(e) => setAbuseDetails(e.target.value)}
          placeholder="details (optional)"
          rows={3}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
        />
        <button
          type="submit"
          disabled={loading}
          aria-disabled={loading}
          className="rounded-md border border-red-200 bg-red-50 px-4 py-2 font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          {loading ? "Submitting report…" : "Submit report"}
        </button>
      </form>
    </section>
  );
});
ReportAbuseSection.displayName = "ReportAbuseSection";

const PeerReviewSection = memo(function PeerReviewSection({
  bookingId,
  setBookingId,
  revieweeId,
  setRevieweeId,
  side,
  setSide,
  rating,
  setRating,
  comment,
  setComment,
  onPeerReview,
  loading,
  reviewError,
}: {
  bookingId: string;
  setBookingId: React.Dispatch<React.SetStateAction<string>>;
  revieweeId: string;
  setRevieweeId: React.Dispatch<React.SetStateAction<string>>;
  side: string;
  setSide: React.Dispatch<React.SetStateAction<string>>;
  rating: number;
  setRating: React.Dispatch<React.SetStateAction<number>>;
  comment: string;
  setComment: React.Dispatch<React.SetStateAction<string>>;
  onPeerReview: (e: React.FormEvent) => Promise<void>;
  loading: boolean;
  reviewError: string | null;
}) {
  return (
    <section className="mt-10 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Reviews
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Submit a peer review
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        After a booking — both sides can leave a review (unique per
        booking/reviewer).
      </p>
      <form
        onSubmit={onPeerReview}
        aria-busy={loading}
        className="mt-4 space-y-3"
      >
        <label
          htmlFor="trust-booking-id"
          className="sr-only"
        >
          Booking UUID
        </label>
        <input
          id="trust-booking-id"
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
          placeholder="booking UUID"
          aria-describedby={reviewError ? "review-error" : undefined}
          aria-invalid={reviewError ? true : undefined}
          className={"w-full rounded-md border px-3 py-2 font-mono text-sm text-slate-900 shadow-sm bg-white " + (reviewError ? "border-red-400" : "border-slate-300")}
          required
        />
        {reviewError && (
          <p id="review-error" role="alert" aria-live="assertive" className="text-xs text-red-600">
            {reviewError}
          </p>
        )}
        <label
          htmlFor="trust-reviewee-id"
          className="sr-only"
        >
          Reviewee user UUID
        </label>
        <input
          id="trust-reviewee-id"
          value={revieweeId}
          onChange={(e) => setRevieweeId(e.target.value)}
          placeholder="reviewee user UUID"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm"
          required
        />
        <label
          htmlFor="trust-review-side"
          className="sr-only"
        >
          Review side
        </label>
        <input
          id="trust-review-side"
          value={side}
          onChange={(e) => setSide(e.target.value)}
          placeholder="side label e.g. guest | host"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
        />
        <div>
          <label
            htmlFor="trust-review-rating"
            className="text-xs text-slate-600"
          >
            Rating 1–5
          </label>
          <input
            id="trust-review-rating"
            type="number"
            min={1}
            max={5}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
          />
        </div>
        <label
          htmlFor="trust-review-comment"
          className="sr-only"
        >
          Review comment
        </label>
        <textarea
          id="trust-review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="comment"
          rows={2}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
        />
        <button
          type="submit"
          disabled={loading}
          aria-disabled={loading}
          className="rounded-md bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          {loading ? "Submitting review…" : "Submit review"}
        </button>
      </form>
    </section>
  );
});
PeerReviewSection.displayName = "PeerReviewSection";

const TrustLoginPrompt = memo(function TrustLoginPrompt() {
  return (
    <div className="mt-10 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
      <Link href="/login" className="font-medium text-teal-700 hover:underline">
        Log in
      </Link>{" "}
      to report abuse or submit peer reviews.
    </div>
  );
});
TrustLoginPrompt.displayName = "TrustLoginPrompt";

const TrustFeedback = memo(function TrustFeedback({
  feedback,
  feedbackRef,
}: {
  feedback: { type: "success" | "error" | null; message: string };
  feedbackRef: React.RefObject<HTMLDivElement>;
}) {
  if (!feedback.type) return null;

  if (feedback.type === "success") {
    return (
      <div
        ref={feedbackRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
        className="mt-6 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm"
      >
        {feedback.message}
      </div>
    );
  }

  return (
    <div
      ref={feedbackRef}
      role="alert"
      aria-atomic="true"
      tabIndex={-1}
      className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700 shadow-sm"
    >
      {feedback.message}
    </div>
  );
});
TrustFeedback.displayName = "TrustFeedback";

export default function TrustPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mySub, setMySub] = useState<string | null>(null);

  const [repUserId, setRepUserId] = useState("");
  const [repScore, setRepScore] = useState<number | null>(null);
  const [repError, setRepError] = useState<string | null>(null);

  const [abuseType, setAbuseType] = useState<"listing" | "user">("listing");
  const [abuseError, setAbuseError] = useState<string | null>(null);
  const [abuseTarget, setAbuseTarget] = useState("");
  const [abuseCategory, setAbuseCategory] = useState("spam");
  const [abuseDetails, setAbuseDetails] = useState("");

  const [bookingId, setBookingId] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [revieweeId, setRevieweeId] = useState("");
  const [side, setSide] = useState("guest");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    const sub = getSubFromJwt(t);
    setMySub(sub);
    if (sub) setRepUserId(sub);
  }, []);

  useEffect(() => {
    if (!feedback.type) return;

    feedbackRef.current?.focus();
  }, [feedback.type]);

  const onReputation = useCallback(async function onReputation(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!repUserId.trim()) {
      setRepError("Please enter a user UUID.");
      return;
    }
    setRepError(null);
    setFeedback({ type: null, message: "" });
    setLoading(true);
    try {
      const r = await getReputation(repUserId.trim());
      setRepScore(r.score);
      setRepError(null);
      setFeedback({
        type: "success",
        message: `Reputation for ${r.user_id}: ${r.score}`,
      });
    } catch (e: unknown) {
      setRepScore(null);
      setRepError(e instanceof Error ? e.message : "Lookup failed");
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Lookup failed",
      });
    } finally {
      setLoading(false);
    }
  }, [repUserId, loading]);

  const onReport = useCallback(async function onReport(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!abuseTarget.trim()) {
      setAbuseError("Please enter a target UUID.");
      return;
    }
    setAbuseError(null);
    setFeedback({ type: null, message: "" });
    setLoading(true);
    try {
      await reportAbuse(token, {
        abuse_target_type: abuseType,
        target_id: abuseTarget.trim(),
        category: abuseCategory,
        details: abuseDetails,
      });
      setMsg("Report submitted.");
      setAbuseDetails("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Report failed");
    } finally {
      setLoading(false);
    }
  }, [token, abuseType, abuseTarget, abuseCategory, abuseDetails, loading]);

  const onPeerReview = useCallback(async function onPeerReview(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!bookingId.trim() || !revieweeId.trim()) {
      setReviewError("Please enter both booking UUID and reviewee UUID.");
      return;
    }
    setReviewError(null);
    setFeedback({ type: null, message: "" });
    setLoading(true);
    try {
      await submitPeerReview(token, {
        booking_id: bookingId.trim(),
        reviewee_id: revieweeId.trim(),
        side,
        rating,
        comment,
      });
      setMsg("Peer review submitted.");
      setComment("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }, [token, bookingId, revieweeId, side, rating, comment, loading]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">Trust &amp; safety</h1>
        <p className="mt-2 text-sm text-slate-600">
          Report abuse and submit peer reviews via gateway → trust-service. Reputation lookup is public.
        </p>

        <ReputationSection
          repUserId={repUserId}
          setRepUserId={setRepUserId}
          onReputation={onReputation}
          loading={loading}
          mySub={mySub}
          repScore={repScore}
          repError={repError}
        />

        {token ? (
          <>
            <ReportAbuseSection
              abuseType={abuseType}
              setAbuseType={setAbuseType}
              abuseTarget={abuseTarget}
              setAbuseTarget={setAbuseTarget}
              abuseCategory={abuseCategory}
              setAbuseCategory={setAbuseCategory}
              abuseDetails={abuseDetails}
              setAbuseDetails={setAbuseDetails}
              onReport={onReport}
              loading={loading}
              abuseError={abuseError}
            />
            <PeerReviewSection
              bookingId={bookingId}
              setBookingId={setBookingId}
              revieweeId={revieweeId}
              setRevieweeId={setRevieweeId}
              side={side}
              setSide={setSide}
              rating={rating}
              setRating={setRating}
              comment={comment}
              setComment={setComment}
              onPeerReview={onPeerReview}
              loading={loading}
              reviewError={reviewError}
            />
          </>
        ) : (
          <p className="mt-8 text-sm text-slate-600">
            <Link href="/login" className="font-medium text-teal-700 hover:underline">
              Log in
            </Link>{" "}
            to report abuse or submit peer reviews.
          </p>
        )}

        {msg && <p className="mt-6 text-sm font-medium text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </main>
    </div>
  );
}
