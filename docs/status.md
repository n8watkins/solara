# Solara — Project Status

_Last updated: 2026-06-20 (interactive UV redesign + sun-path A/B + mandatory sign-in — branch `mobile-uv-ab-arc`, PREVIEW-ONLY, NOT in production)_

A one-page snapshot: what just shipped, where we stand, and the next action. For the
launch checklist history see [`GO_LIVE.md`](./GO_LIVE.md); for phase definitions see
[`ROADMAP_V1.2_V2.md`](./ROADMAP_V1.2_V2.md); for the full zero-context briefing see
[`HANDOFF.md`](./HANDOFF.md).

---

## ⚠️ Branch status — preview only, NOT in production yet

The current wave of work lives on branch **`mobile-uv-ab-arc`** (9 commits ahead of
`main`). It is **NOT merged to `main` and NOT deployed to production.**

- **Production** (https://uv-activity-planner.web.app) still reflects the EARLIER
  mobile-first wave recorded below — it does NOT have the new UV redesign, the sun-path,
  or the mandatory sign-in.
- **The new work is testable on a Firebase preview channel:**
  https://uv-activity-planner--uv-arc-apa3pw9t.web.app (the chosen sun-path design).
- **Before merge:** a bug review + verification on a real device are PENDING. The
  dashboard could not be auto-screenshotted this session because sign-in is now
  mandatory (no guest path) — so it needs hands-on device verification.

---

## TL;DR

**Production is LIVE and unchanged: https://uv-activity-planner.web.app** (the
mobile-first wave). Google sign-in + prefs sync are verified end-to-end; GA4 tracks.

**On branch `mobile-uv-ab-arc` (preview-only, see above):** the UV card was rebuilt
into an interactive, scrollable, tappable hour strip synced to an interactive sun path;
the A/B between arc and no-arc was decided in favour of the **sun-path design** (kept,
with a settings toggle to hide the arc). Sign-in is now **mandatory** — the guest
funnel from the prior wave was REVERSED; visitors must sign in with Google to reach the
dashboard. Pending bug review + device verification before this merges to `main`.

---

## What we just did (2026-06-20, interactive-UV + sun-path A/B session — branch `mobile-uv-ab-arc`, NOT deployed)

All of the below is on branch **`mobile-uv-ab-arc`**, 9 commits ahead of `main`,
**preview-only** (channel `uv-arc-apa3pw9t`), not merged, not in production.

- **Interactive UV redesign — strip then sun path** (`89bfab4`, `45ff545`): replaced
  the old fit-to-width UV bars + static sun arc with a horizontally-scrollable, zoomed,
  tappable **UV strip** — fixed-width bars, current hour auto-centered and
  ring-highlighted, tap any hour to pin its detail. UV **numbers are non-selectable**,
  which fixes a tap-to-Google bug (long-press/selection used to trigger the OS text
  selection → "search Google" sheet). Then a compact **interactive sun path** was
  reintroduced above the strip, synced to it via a shared `focusedHour` lifted into
  Dashboard — tapping/scrubbing either keeps both in lockstep (arc markers ride the same
  bezier the curve is drawn from, so x maps 1:1 to the hour).
- **UV-card polish** (`1c89d5d`): one **single focused-hour readout** drives the card
  header (UV · temp · condition · label); horizontal **strip ↔ arc scroll-sync** (the
  bar nearest the strip's center focuses, rAF-debounced); the arc line is a **per-hour
  UV-color gradient**; smaller burn-time / vitamin-D cards; tighter swipeable
  TipCarousel; arc gated on `prefs.showSunPath !== false`.
- **Settings + chrome** (`75aa29b`): PreferencesModal renders **full-screen on mobile**
  (≤640px) and a centered **modal on desktop**, with even L/R padding; added
  `lib/useBodyScrollLock.ts` (SSR-safe, ref-counted) and wired it into PreferencesModal
  + ActivityModalShell so the page behind can't scroll; the header's standalone
  ⚙️ Settings + Sign out collapsed into a single **profile-avatar dropdown**.
- **MANDATORY Google sign-in** (`2f451eb`) — **REVERSES the prior guest-funnel work.**
  Guests can no longer reach the dashboard; a signed-out visitor never gets in (no
  local-prefs fallback). Onboarding rebuilt to end at a **required** Google sign-in (no
  "skip"), with the activity-selection step and all the "free / 3 activities / calendar"
  marketing removed, page scroll locked during setup, and each step's primary CTA pinned
  to the thumb zone.
- **Marketing strip + arc-off build flag** (`9f1d9d0`): Welcome loses the
  "No sign-up required" line and feature pills (CTA → "Get started"); new
  `NEXT_PUBLIC_HIDE_SUNPATH` build flag lets one codebase ship both the arc-on and
  arc-off preview builds (the A/B).
- **Consolidated readout + bigger arc + modal day picker** (`17b3e76`): UV card
  restructured top→bottom = one **fixed-height readout pinned at the TOP**, then the sun
  arc, then the strip — a two-row layout so a long label like "Very high" no longer hides
  the temp or jumps the card height (fixes a temp-hidden / card-jump bug). Bigger
  `.sun-arc-plot` with ~3h hour ticks and the day's peak marked **on the arc**. Removed
  the **Share** button + the "Peak X at Ypm" header line. Day picker no longer scrolls
  horizontally: **Today / Tomorrow + a "More days" modal** (vertical list; locked days
  show the upgrade hint inside). Activities header = single **"+ Add Activity" (left)**
  and **"Manage" (right)**.

**Decision:** the **sun-path design WON** the arc-vs-no-arc A/B and is the chosen
direction — kept, with a settings toggle to hide the arc (`prefs.showSunPath`, plus the
`NEXT_PUBLIC_HIDE_SUNPATH` build flag).

**Verification:** `tsc` clean · 116/116 tests · static build green · deployed to the
**preview channel** only. The signed-in dashboard was NOT auto-screenshotted
(mandatory sign-in blocks the headless guest path) → needs real-device verification.

## What we just did (2026-06-20, mobile-first session — IN PRODUCTION)

- **Mobile-first dashboard redesign + iOS install hint** (`b8cd343`, `164f545`,
  `e650799`, `8422928`; pushed, deployed green):
  - **iOS "Add to Home Screen" hint** (`b8cd343`, `components/InstallPrompt.tsx`):
    Chromium's `beforeinstallprompt` never fires on iOS, and iOS only allows web push
    for home-screen-installed PWAs — so iOS Safari users now get manual "Share → Add to
    Home Screen" instructions, the entry point for enabling push on iOS.
  - **Header rebuilt so it never collides on phones** (`164f545`,
    `components/Header.tsx` + new `.hdr-*` classes in `app/globals.css`): the location
    pill wraps to its own full-width row at ≤560px (was clipping the logo and
    overlapping the Pro badge with the city name); desktop stays a single row,
    unchanged.
  - **Sticky compact top-tabs nav** (`e650799`, `components/App.tsx`): header +
    Dashboard/Calendar tabs share one sticky container, so the nav stays pinned while
    content scrolls.
  - **Dashboard mobile-first pass** (`8422928`, `components/Dashboard.tsx`): a "best
    window today" hero card up top (icon · time · peak UV · "Safe now" badge); the
    standalone Plan-ahead section merged INTO Activities as a "Best day this week"
    sub-section (`components/PlanAhead.tsx` retitled); tighter phone density via a new
    `.dash-stack` class (gap 18px→13px at ≤560px). Desktop layout preserved.
- **Enable-notifications control in Preferences** (`components/PreferencesModal.tsx`):
  users can now turn on push from the settings modal (General tab → "Morning sun alerts"),
  outside the one-time 🔔 banner.

## What we just did (2026-06-12, third session)

- **Verified Google sign-in + prefs sync live** (Auth user + Firestore doc via Admin
  SDK). Set the user's tier to `paid` (Admin SDK, user-approved) to unlock the
  Pro-gated notifications toggle for testing.
- **GA4 added** (`194f1c3`, hardened `51efa61`): `G-XN0QQXMG36`, baked at build,
  verified on the live site.
- **Node 24 forcing opted in early** (`69bc3a0`) — deploy green; June 16 item closed.
- **Activities gated behind sign-in** (`18116f1`): anonymous limit 0, onboarding
  sign-in gate with skip, dashboard sign-in card.
- **Guest mobile declutter** (`03f8bf1`): no tab bar / day tabs / upsell pills /
  profile pill for guests; UV timeline can never scroll horizontally; verified at
  375px with Playwright.
- **Full code review run, all 7 findings fixed** (`51efa61`) — incl. closing the
  legacy-guest activity loophole and restoring the guest refresh button.
- Deleted stray `~/projects/` junk folder (only a dev `.next` cache).
- **Notification production-correctness fixes** (`3962457`, `0b2bf1e`, committed just
  after this section was first written): notification icons now point at real SVG
  assets; all `NEXT_PUBLIC_SITE_URL` fallbacks point at the real domain
  (`uv-activity-planner.web.app`, not the non-existent `solara.web.app`) so share
  links / OG / push click-through never go dead; and the cron computes "today" from
  the **location's** UTC offset (Open-Meteo `timezone=auto`) instead of the runner's
  UTC clock — fixing the wrong-day forecast for UTC+11/+12 users. Deployed green
  (`27454979134`).

**Verification:** `tsc` clean · 116/116 tests · build green · all deploys green ·
live site 200.

## Where we are now

| Area | State |
|---|---|
| Branch `mobile-uv-ab-arc` (UV redesign + sun-path + mandatory sign-in) | 🟡 preview-only on channel `uv-arc-apa3pw9t`; NOT merged to `main`, NOT in production. Pending bug review + device verification |
| Sun-path A/B decision | ✅ DECIDED: sun-path design wins (toggle to hide the arc) |
| Live site (production = earlier mobile-first wave) | ✅ https://uv-activity-planner.web.app |
| CI deploy (push → hosting + rules) | ✅ green, Node 24 forced |
| Google sign-in + prefs sync | ✅ verified live 2026-06-12 |
| Google Analytics 4 | ✅ live (`G-XN0QQXMG36`) |
| Guest funnel (UV-only dashboard, sign-in for activities) | ✅ live, mobile-verified |
| Notification cron | 🟡 dry-run green (0 users); user signed in + Pro but has NOT enabled notifications — FCM send unproven. Two enable paths now: 🔔 banner + Preferences modal |
| P5 Stripe / P7b live feed | ⏸ scaffolded; DECIDED: Blaze + functions when monetizing (no Vercel) |
| P1 Google Calendar OAuth | ⏸ needs OAuth client ID; bundle with monetization |

## What we do next

1. **Verify the `mobile-uv-ab-arc` preview on a real device** (mandatory sign-in
   blocked the headless screenshot): sign in on the preview
   (https://uv-activity-planner--uv-arc-apa3pw9t.web.app), exercise the UV strip +
   sun-path scroll-sync, the full-screen mobile Settings, the profile-avatar dropdown,
   the Today/Tomorrow/"More days" day picker, and the mandatory onboarding sign-in flow.
2. **Bug review** of the 9-commit wave, then **merge `mobile-uv-ab-arc` → `main`** (push
   deploys to production). The sun-path design is the chosen direction.
3. **USER: enable notifications on the live site** (🔔 banner ~4s after load, or
   Preferences → notifications) → verify `fcmToken` in their doc →
   `gh workflow run notify.yml -f dry_run=true` → real send. Then ask user about
   flipping tier back to `free`.
4. Work the 🟡 rows in `V1.2_TEST_PLAN.md` against live.
5. Monetization when user says go (Blaze + functions deploy).

## Known gaps / watch-items

- **`mobile-uv-ab-arc` is unverified on device** — sign-in is mandatory so the dashboard
  couldn't be auto-screenshotted; needs hands-on testing before merge.
- **Pending UI follow-ups on the branch:** activity cards still want a compact /
  collapsible / category treatment; a per-hour **"share this time"** feature is wanted
  (the old global Share button was removed in `17b3e76`).
- **Mandatory sign-in reverses the guest funnel** — confirm with the user this is the
  intended direction before merging (the prior wave deliberately built a guest UV-only
  dashboard).
- No `customer.subscription.updated` / refund / dispute handling in the Stripe webhook.
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
