# Solara — Project Status

_Last updated: 2026-06-20 (mobile-first redesign + iOS install hint + notifications in Preferences)_

A one-page snapshot: what just shipped, where we stand, and the next action. For the
launch checklist history see [`GO_LIVE.md`](./GO_LIVE.md); for phase definitions see
[`ROADMAP_V1.2_V2.md`](./ROADMAP_V1.2_V2.md); for the full zero-context briefing see
[`HANDOFF.md`](./HANDOFF.md).

---

## TL;DR

**Solara is LIVE: https://uv-activity-planner.web.app.** Google sign-in + prefs sync
are verified end-to-end with a real user. GA4 is tracking. Guests now get a clean,
nag-free UV dashboard; activities require (free) sign-in. The only unproven launched
feature is the FCM push pipeline — blocked on the user clicking Enable on the
notification banner.

---

## What we just did (2026-06-20, mobile-first session)

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
| Live site | ✅ https://uv-activity-planner.web.app |
| CI deploy (push → hosting + rules) | ✅ green, Node 24 forced |
| Google sign-in + prefs sync | ✅ verified live 2026-06-12 |
| Google Analytics 4 | ✅ live (`G-XN0QQXMG36`) |
| Guest funnel (UV-only dashboard, sign-in for activities) | ✅ live, mobile-verified |
| Notification cron | 🟡 dry-run green (0 users); user signed in + Pro but has NOT enabled notifications — FCM send unproven. Two enable paths now: 🔔 banner + Preferences modal |
| P5 Stripe / P7b live feed | ⏸ scaffolded; DECIDED: Blaze + functions when monetizing (no Vercel) |
| P1 Google Calendar OAuth | ⏸ needs OAuth client ID; bundle with monetization |

## What we do next

1. **USER: enable notifications on the live site** (🔔 banner ~4s after load, or
   Preferences → notifications) → verify `fcmToken` in their doc →
   `gh workflow run notify.yml -f dry_run=true` → real send. Then ask user about
   flipping tier back to `free`.
2. Work the 🟡 rows in `V1.2_TEST_PLAN.md` against live.
3. Monetization when user says go (Blaze + functions deploy).

## Known gaps / watch-items

- No `customer.subscription.updated` / refund / dispute handling in the Stripe webhook.
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
