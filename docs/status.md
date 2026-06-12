# Solara — Project Status

_Last updated: 2026-06-12_

A one-page snapshot: what just shipped, where we stand, and the next action. For the
launch checklist history see [`GO_LIVE.md`](./GO_LIVE.md); for phase definitions see
[`ROADMAP_V1.2_V2.md`](./ROADMAP_V1.2_V2.md); for the full zero-context briefing see
[`HANDOFF.md`](./HANDOFF.md).

---

## TL;DR

**Solara is LIVE: https://uv-activity-planner.web.app** (first deploy 2026-06-12).
All GitHub Actions secrets are set, the Firestore database exists with security rules
deployed, and CI deploys on every push to `main`. A major UI/funnel rework shipped the
same day. Remaining: verify Google sign-in + notifications end-to-end on the live site,
then the optional Blaze/monetization stage (or its Vercel alternative).

---

## What we just did (2026-06-12 session)

**Unblocked and executed the launch:**
- Set all Actions secrets (Firebase config ×6, site URL, VAPID key, service account).
- Created the Firestore DB (`nam5`, production) and granted the admin-SDK service
  account the IAM roles CI needs to deploy rules (Service Usage Consumer + Firebase
  Rules Admin).
- Workflows bumped to actions v5 / Node 24 ahead of GitHub's June 16 forcing.
- Deploy workflow fully green: hosting + Firestore rules. Site smoke-tested.

**Shipped a user-directed UI/funnel rework** (see `HANDOFF.md` for commit hashes):
onboarding with curated starter activities + Google sign-in CTA, de-Guested header
with Google button/avatar, UV-by-hour hero dashboard with sun-path toggle, left-nav
settings modal, vertical safe-window rows with time-of-day cues, wider activity
editor, CSS polish. Plus two real bug fixes: sign-in no longer clobbers existing
cloud prefs (could downgrade a Pro user), and mid-onboarding sign-in no longer
bounces to the welcome screen.

**Verification:** `tsc` clean · 114/114 tests · production build succeeds · live site 200.

**Added Google Analytics 4** (`194f1c3`): gtag snippet in `app/layout.tsx` gated on
`NEXT_PUBLIC_GA_MEASUREMENT_ID` (= `G-XN0QQXMG36`, set as Actions secret + in
`.env.local`); verified live on the deployed site.

**Activities now require sign-in** (`18116f1`, user decision 2026-06-12): anonymous
tier limit 0; onboarding step 3 shows a Google sign-in gate (skippable straight to
the UV dashboard); dashboard shows a sign-in card instead of Add/Manage for guests.

## Where we are now

| Area | State |
|---|---|
| Live site | ✅ https://uv-activity-planner.web.app |
| CI deploy (push → hosting + rules) | ✅ green |
| Firestore + security rules | ✅ deployed (tier-lock active) |
| V1.2 + P6 + P7a + UI rework | ✅ live |
| Google sign-in on live site | ✅ verified 2026-06-12: user signed in on live site; `users/{uid}` doc in Firestore with correct prefs (schema v2, onboarding complete, tier free) |
| Notification cron | 🟡 dry-run green 2026-06-12 (auth + Firestore query OK, 0 users); FCM send unproven — user signed in but has NOT enabled notifications yet (no `notificationsEnabled` in their doc) |
| P5 Stripe / P7b live feed | ⏸ scaffolded; DECIDED: stay on Firebase → Blaze upgrade + functions deploy when monetizing |
| P1 Google Calendar OAuth | ⏸ needs OAuth client ID |

## What we do next

1. ~~USER: enable Authentication in Firebase console~~ ✅ done 2026-06-12.
2. ~~Verify Google sign-in + prefs sync on the live site~~ ✅ done 2026-06-12.
3. Prove notifications: USER must enable notifications on the live site →
   `gh workflow run notify.yml -f dry_run=true` → then a real push. (0-user dry-run
   already green; user is signed in but hasn't opted in yet.)
4. ~~Node 24 forcing~~ ✅ `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` set in deploy.yml
   2026-06-12; deploy verified green under Node 24 ahead of the June 16 forcing.
5. Work the 🟡 rows in `V1.2_TEST_PLAN.md`.
6. When monetizing: Blaze + functions deploy. (DECIDED 2026-06-12: staying on
   Firebase; Vercel port is off the table.)

## Known gaps / watch-items

- No `customer.subscription.updated` / refund / dispute handling in the Stripe webhook.
- `scripts/send-notifications.js` "today" is runner-UTC vs location-local — wrong-day
  edge for UTC+11/+12 users.
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
