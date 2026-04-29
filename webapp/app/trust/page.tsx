"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReputation, reportAbuse, submitPeerReview } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";

function TrustHeaderSection() {
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
}

function ReputationSection({
  repUserId,
  setRepUserId,
  onReputation,
  loading,
  mySub,
  repScore,
}: {
  repUserId: string;
  setRepUserId: React.Dispatch<React.SetStateAction<string>>;
  onReputation: (e: React.FormEvent) => Promise<void>;
  loading: boolean;
  mySub: string | null;
  repScore: number | null;
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
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm"
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
      {mySub && (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-teal-700 hover:underline"
          onClick={() => setRepUserId(mySub)}
        >
          Use my account id
        </button>
      )}
      {repScore != null && (
        <p
          data-testid="trust-reputation-score"
          className="mt-4 text-sm text-slate-600"
        >
          Score: <strong className="text-teal-800">{repScore}</strong>
        </p>
      )}
    </section>
  );
}

function ReportAbuseSection({
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
}

function PeerReviewSection({
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
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm"
          required
        />
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
}

function TrustLoginPrompt() {
  return (
    <div className="mt-10 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
      <Link
        href="/login"
        className="font-medium text-teal-700 hover:underline"
      >
        Log in
      </Link>{" "}
      to report abuse or submit peer reviews.
    </div>
  );
}

function TrustFeedback({
  feedback,
}: {
  feedback: { type: "success" | "error" | null; message: string };
}) {
  if (!feedback.type) return null;

  if (feedback.type === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-6 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm"
      >
        {feedback.message}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700 shadow-sm"
    >
      {feedback.message}
    </div>
  );
}

export default function TrustPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mySub, setMySub] = useState<string | null>(null);

  const [repUserId, setRepUserId] = useState("");
  const [repScore, setRepScore] = useState<number | null>(null);

  const [abuseType, setAbuseType] = useState<"listing" | "user">("listing");
  const [abuseTarget, setAbuseTarget] = useState("");
  const [abuseCategory, setAbuseCategory] = useState("spam");
  const [abuseDetails, setAbuseDetails] = useState("");

  const [bookingId, setBookingId] = useState("");
  const [revieweeId, setRevieweeId] = useState("");
  const [side, setSide] = useState("guest");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const [loading, setLoading] = useState(false);
  type FeedbackState = {
    type: "success" | "error" | null;
    message: string;
  };

  const [feedback, setFeedback] = useState<FeedbackState>({
    type: null,
    message: "",
  });

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    const sub = getSubFromJwt(t);
    setMySub(sub);
    if (sub) setRepUserId(sub);
  }, []);

  async function onReputation(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setFeedback({ type: null, message: "" });
    setLoading(true);
    try {
      const r = await getReputation(repUserId.trim());
      setRepScore(r.score);
      setFeedback({
        type: "success",
        message: `Reputation for ${r.user_id}: ${r.score}`,
      });
    } catch (e: unknown) {
      setRepScore(null);
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Lookup failed",
      });
    } finally {
      setLoading(false);
    }
  }

  async function onReport(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!token) return;
    setFeedback({ type: null, message: "" });
    setLoading(true);
    try {
      await reportAbuse(token, {
        abuse_target_type: abuseType,
        target_id: abuseTarget.trim(),
        category: abuseCategory,
        details: abuseDetails,
      });
      setFeedback({
        type: "success",
        message: "Report submitted.",
      });
      setAbuseDetails("");
    } catch (e: unknown) {
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Report failed",
      });
    } finally {
      setLoading(false);
    }
  }

  async function onPeerReview(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!token) return;
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
      setFeedback({
        type: "success",
        message: "Peer review submitted.",
      });
      setComment("");
    } catch (e: unknown) {
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Review failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/30 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <TrustHeaderSection />

        <ReputationSection
          repUserId={repUserId}
          setRepUserId={setRepUserId}
          onReputation={onReputation}
          loading={loading}
          mySub={mySub}
          repScore={repScore}
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
            />
          </>
        ) : (
          <TrustLoginPrompt />
        )}

        <TrustFeedback feedback={feedback} />
      </main>
    </div>
  );
}
