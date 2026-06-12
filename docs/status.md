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

## Where we are now

| Area | State |
|---|---|
| Live site | ✅ https://uv-activity-planner.web.app |
| CI deploy (push → hosting + rules) | ✅ green |
| Firestore + security rules | ✅ deployed (tier-lock active) |
| V1.2 + P6 + P7a + UI rework | ✅ live |
| Google sign-in on live site | 🔴 blocked — Firebase Auth confirmed NOT provisioned (`CONFIGURATION_NOT_FOUND`); user must enable in console |
| Notification cron | 🟡 dry-run green 2026-06-12 (auth + Firestore query OK, 0 users); FCM send unproven until a user opts in |
| P5 Stripe / P7b live feed | ⏸ scaffolded, needs Blaze — or port to Vercel API routes (decision pending) |
| P1 Google Calendar OAuth | ⏸ needs OAuth client ID |

## What we do next

1. **USER:** enable Authentication in Firebase console (Authentication → Get started →
   Sign-in method → Google). Confirmed unprovisioned — sign-in cannot work until then.
2. Verify Google sign-in + prefs sync on the live site (no redeploy needed; live
   bundle config verified correct).
3. Prove notifications: opt in as a real user → `gh workflow run notify.yml -f dry_run=true`
   → then a real push. (0-user dry-run already green.)
4. Glance at the first deploy after **June 16** (Node 24 forcing on `action-hosting-deploy@v0`).
5. Work the 🟡 rows in `V1.2_TEST_PLAN.md`.
6. When monetizing: Blaze + functions deploy, **or** port webhook/feed to Vercel (leaning
   Vercel — no Blaze cost; requires dropping static export).

## Known gaps / watch-items

- No `customer.subscription.updated` / refund / dispute handling in the Stripe webhook.
- `scripts/send-notifications.js` "today" is runner-UTC vs location-local — wrong-day
  edge for UTC+11/+12 users.
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
