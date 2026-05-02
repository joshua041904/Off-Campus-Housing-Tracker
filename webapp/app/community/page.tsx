import Link from "next/link";
import { Nav } from "@/components/Nav";

const COMMUNITY_PILLARS = [
  {
    title: "Trusted interactions",
    description:
      "Use trust tools, peer reviews, and reporting flows to keep community interactions safer and easier to navigate.",
    href: "/trust",
    cta: "Open trust tools",
    accent: "bg-emerald-50 text-emerald-700",
  },
  {
    title: "Housing updates",
    description:
      "Track listings, compare options, and keep your search active without bouncing between disconnected tools.",
    href: "/listings",
    cta: "Browse listings",
    accent: "bg-teal-50 text-teal-700",
  },
  {
    title: "Shared project context",
    description:
      "See the mission behind the platform and understand how the product is being shaped for students and teams.",
    href: "/mission",
    cta: "Read the mission",
    accent: "bg-sky-50 text-sky-700",
  },
] as const;

const COMMUNITY_STREAMS = [
  {
    label: "Supportive discovery",
    title: "Find the right next step faster",
    body:
      "A strong community page should guide people toward the most useful actions, not dump every feature into one flat list.",
  },
  {
    label: "Clear pathways",
    title: "Move from browsing to action",
    body:
      "The layout emphasizes common journeys like checking trust signals, exploring housing, and understanding how the platform works.",
  },
  {
    label: "Consistent components",
    title: "Reuse the same visual language",
    body:
      "Cards, button treatments, spacing, and section rhythm now match the cleaner patterns used across the rest of the webapp.",
  },
] as const;

const COMMUNITY_GUIDES = [
  {
    eyebrow: "Safety first",
    title: "Report abuse or review another user",
    body:
      "Trust and safety tools help the housing community stay more transparent and more accountable after real interactions.",
    href: "/trust",
    cta: "Go to trust",
  },
  {
    eyebrow: "Search smarter",
    title: "Explore listings with better context",
    body:
      "Use the listings experience to compare options, preview amenities, and understand what is actually available before you commit.",
    href: "/listings",
    cta: "Open listings",
  },
  {
    eyebrow: "Stay organized",
    title: "Keep track of your housing activity",
    body:
      "Signed-in users can continue into the dashboard and booking flows when they need saved history, watchlist management, or reservation follow-up.",
    href: "/dashboard",
    cta: "View dashboard",
  },
] as const;

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f7fbfa] via-white to-[#eef8f5] text-slate-900">
      <Nav />

      <main>
        <section className="relative overflow-hidden border-b border-slate-200/70">
          <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_30%)]" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Community
              </p>
              <h1
                className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl md:text-6xl"
                data-testid="community-heading"
              >
                A cleaner hub for housing trust, guidance, and shared context.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                The community experience should feel as intentional as the rest
                of the product. This page organizes the most relevant housing
                resources into clearer paths so people know where to go next.
              </p>

              <div className="mt-10 flex flex-wrap gap-4">
                <Link
                  href="/trust"
                  className="rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600"
                >
                  Explore trust tools
                </Link>
                <Link
                  href="/listings"
                  className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Browse listings
                </Link>
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.18)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Community overview
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">
                    What this page helps you do
                  </h2>
                </div>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
                  New layout
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {COMMUNITY_STREAMS.map((item, index) => (
                  <article
                    key={item.title}
                    className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
                          {item.label}
                        </p>
                        <h3 className="mt-2 text-base font-semibold text-slate-900">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {item.body}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Community paths
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Start with the part of the community experience you need most
              </h2>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {COMMUNITY_PILLARS.map((pillar) => (
                <article
                  key={pillar.title}
                  className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-200/60 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${pillar.accent}`}
                  >
                    Community resource
                  </span>
                  <h3 className="mt-4 text-xl font-semibold text-slate-900">
                    {pillar.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {pillar.description}
                  </p>
                  <Link
                    href={pillar.href}
                    className="mt-6 inline-flex rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    {pillar.cta}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200/70 bg-slate-50/70 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                  Guides
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  Keep the page readable, useful, and easy to scan
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                Community pages work best when they group related actions,
                explain purpose clearly, and avoid burying important routes in
                long walls of text.
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {COMMUNITY_GUIDES.map((guide) => (
                <article
                  key={guide.title}
                  className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
                    {guide.eyebrow}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-900">
                    {guide.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {guide.body}
                  </p>
                  <Link
                    href={guide.href}
                    className="mt-6 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    {guide.cta}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
