# Root cause analyses — Off-Campus Housing Tracker

Short postmortems for user-visible regressions fixed in this repo. Operational cluster steps stay in **Runbook.md**.

---

## 2026-05-10 — Browser `/listings/{uuid}` showed raw JSON instead of the Next.js listing page

**Symptom:** Visiting `/listings/<uuid>` (e.g. from “View on marketplace” on the landlord dashboard) returned a JSON document, not the marketplace UI.

**Root cause:** Caddy’s `@api` matcher included **`/listings/*`**, sending those browser navigations to **api-gateway**, which proxies to **listings-service** and returns JSON for the listing resource. Next.js routes **`/listings`** and **`/listings/[id]`** live behind nginx and never received the request.

**Fix:** Remove bare **`/listings/*`** from the Caddy `@api` path list (keep **`/api/listings/*`** under `/api/*`). Mirror the same rule in the repo **Caddyfile** used for local / non-ConfigMap setups.

**Verification:** Open `https://<host>/listings/<valid-uuid>` — HTML app shell and listing page, not `application/json`.

---

## 2026-05-10 — Community post detail images broken (`?` / 403) while feed thumbnails looked fine

**Symptom:** Feed cards showed images; opening the post showed a broken image / 403 on `/api/media/public/...`.

**Root cause:** `GET /community/posts/:id` in **listings-service** returned `images` straight from the database **without** `mapCommunityImagesJson`, so signatures/TTL were stale or missing compared to the list endpoint which already re-signed URLs.

**Fix:** Pass detail `images` through **`mapCommunityImagesJson`** the same way as list and create responses.

**Verification:** Signed-in or anonymous: detail `<img src>` returns **200** and **`image/*`** for GET (same as feed).

---

## 2026-05-10 — Mission page showed “Log in / Register” while other pages showed the signed-in nav

**Symptom:** `/mission` always displayed guest nav links.

**Root cause:** **Mission** was a **server component** rendering `<Nav />` with no `email` prop. `Nav` only reads **`email`** from props (client pages use `getStoredEmail()` in `useEffect`).

**Fix:** Make **`app/mission/page.tsx`** a client page, hydrate **`email`** from **`getStoredEmail()`**, pass **`email`** into **`Nav`**. Copy tweak: Dashboard button label no longer says “(after login)” when authenticated state is visible from the header.

---

## 2026-05-10 — Community feed had no working vote controls; comment votes felt “stuck”

**Symptoms:** Feed cards only printed “N votes” with no controls. On the post page, a single global `voteBusy` flag disabled all vote buttons while any vote was in flight.

**Root cause:** (1) Feed UI never called **`voteCommunityPost`**. (2) List endpoint did not return **`yourVote`** when a Bearer was present (gateway forwards **`x-user-id`**). (3) One boolean **`voteBusy`** blocked the entire tree during one request.

**Fix:** (1) Add **`your_vote`** to **`GET /community/posts`** when **`x-user-id`** is a UUID. (2) **`fetchCommunityPostsPage`** accepts optional **`token`** and sends **`Authorization`**. (3) Feed cards: **`voteCommunityPost`** + ▲/▼ row outside the post **`Link`**. (4) Post detail: per-target busy key (`post` vs `c:<commentId>`).

---

## 2026-05-10 — Community board felt “squeezed” next to messaging

**Symptom:** Messages column consumed horizontal space beside the feed.

**Root cause:** **`MessagesWorkspace variant="sidebar"`** was always mounted in the main layout.

**Fix:** Use the same pattern as **`GlobalMessageDock`**: full-width feed + **floating “Messages”** button + **slide-over drawer** with **`variant="drawer"`**; listen for **`OCH_MESSENGER_PREFILL_EVENT`** to open the drawer when messaging the author from a post.

---

## 2026-05-10 — Group messaging: archive / hide / first message failed or returned 403

**Symptoms:** New **group** threads could not send the first message; **Archive** or **Hide from inbox** appeared to do nothing or returned **403**; landlord tools confused **DM** `thread_id` with **group** `group_id`.

**Root cause:** (1) **Webapp** treated “group” only when `groupId` was present; **empty new groups** had no `group_id` on the thread summary, so the client sent **`thread_id`** and the backend rejected or misrouted. (2) **messaging-service** archive/delete access checks only considered rows where **`thread_id`** matched the id, so **group** conversations (or groups with no messages yet) failed membership checks.

**Fix:** Client: treat **`kind === "group"`** (or equivalent) so **`selectedId` is `group_id`** even when the group is empty. Server: allow archive/hide/delete when the user is a **group member** or has **`group_id`** / **`thread_id`** access consistent with the conversation type.

**Verification:** Create empty group → send first message succeeds; archive/hide group as member → 200 and inbox updates.

---

## Follow-ups

- After changing **Caddy** routing, roll the **caddy-h3** (or edge) deployment / reload Caddy so the path matcher update is live.
- Rebuild **listings-service** and **webapp** so HTTP + UI fixes ship together.
- **Redis/Lua:** See **Runbook.md** (Redis/Lua readiness) — inventory, key namespacing, NOSCRIPT/EVAL fallback for messaging cache, JTI revocation keys, tenant-ban TTL — then rebuild **messaging-service**, **api-gateway**, **auth-service**, **booking-service**, and **common** consumers as needed before the next full rollout.
