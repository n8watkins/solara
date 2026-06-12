# Solara — Project Status

_Last updated: 2026-06-12 (end of third session)_

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
| Notification cron | 🟡 dry-run green (0 users); user signed in + Pro but has NOT enabled notifications — FCM send unproven |
| P5 Stripe / P7b live feed | ⏸ scaffolded; DECIDED: Blaze + functions when monetizing (no Vercel) |
| P1 Google Calendar OAuth | ⏸ needs OAuth client ID; bundle with monetization |

## What we do next

1. **USER: enable notifications on the live site** (🔔 banner, ~4s after load) →
   verify `fcmToken` in their doc → `gh workflow run notify.yml -f dry_run=true` →
   real send. Then ask user about flipping tier back to `free`.
2. Work the 🟡 rows in `V1.2_TEST_PLAN.md` against live.
3. Monetization when user says go (Blaze + functions deploy).

## Known gaps / watch-items

- No `customer.subscription.updated` / refund / dispute handling in the Stripe webhook.
- `scripts/send-notifications.js` "today" is runner-UTC vs location-local — wrong-day
  edge for UTC+11/+12 users.
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
