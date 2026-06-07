# Solara — Project Status

_Last updated: 2026-06-07_

A one-page snapshot: what just shipped, where we stand, and the next action. For the
full ordered launch checklist see [`GO_LIVE.md`](./GO_LIVE.md); for phase definitions see
[`ROADMAP_V1.2_V2.md`](./ROADMAP_V1.2_V2.md).

---

## TL;DR

All V1.2 + V2 code is **built, reviewed, committed, and pushed** to `origin/main`.
The app is **not live yet** — blocked on one thing: **no GitHub Actions secrets are set**,
so CI deploy and the notification cron both fail. Setting the secrets is the only remaining
gate to shipping the Spark baseline. Everything past that is optional Blaze features.

---

## What we just did (this session)

**Code review of the P5/P7b scaffold + monetization surface, then addressed every finding:**

- **Security — tier self-grant closed.** `firestore.rules` now lets clients set any
  non-paid tier but only the Stripe webhook's Admin SDK may write `tier == 'paid'`.
  (Previously any signed-in user could self-grant Pro from the console.)
- **Ops — functions deployable.** Added the `functions` source to `firebase.json`;
  committed the `functions/` package (`stripeWebhook` + `calendarFeed`).
- **P7b feed wired end-to-end.** It was dead (no user could ever hold a feed token).
  Added `lib/feed.ts`, the `calendarFeedToken` pref + validator, and a `CalendarFeed`
  Subscribe UI (signed-in + feed-configured only).
- **Stripe lifecycle complete.** Webhook grants Pro on `checkout.session.completed` and
  **revokes** it on `customer.subscription.deleted` (via persisted `stripeCustomerId`).
- **Firestore write hardening.** `ignoreUndefinedProperties` so prefs writes with absent
  optional fields don't throw — a latent bug that likely affected existing signed-in users.
- **Notifications hardened + testable.** Added a `DRY_RUN` mode (+ a `dry_run` toggle on
  `notify.yml`) to exercise the full pipeline without sending pushes; auto-clears dead FCM
  tokens; made the module importable and sanity-checked its message output.
- **Docs.** Wrote [`GO_LIVE.md`](./GO_LIVE.md) (staged launch runbook) and updated
  `DEPLOYMENT.md`.

**Verification:** `tsc` clean · 114/114 tests · production build succeeds · functions
`node --check` clean.

## Where we are now

| Area | State |
|---|---|
| V1.2 (P0–P4) + P6 + P7a | ✅ code complete, committed, pushed |
| P5 Stripe webhook | ✅ scaffolded (deploy + secrets pending — Blaze) |
| P7b live feed | ✅ both halves wired (deploy + `NEXT_PUBLIC_FUNCTIONS_URL` pending — Blaze) |
| P1 calendar | ✅ code complete (OAuth client ID pending) |
| CI deploy | ❌ **failing** — `FIREBASE_SERVICE_ACCOUNT` secret missing |
| Notification cron | ❌ **failing daily** — same missing secret |
| Live site | ⛔ not deployed |

## What we do next

1. **🔴 Set the GitHub Actions secrets** (the blocker). Recipe is in `GO_LIVE.md` Stage 0:
   six `NEXT_PUBLIC_FIREBASE_*` values + `FIREBASE_SERVICE_ACCOUNT` JSON. _Owner: Nathan
   (Firebase console credentials)._
2. **Re-run the deploy** → ships the Spark baseline (V1.2 + P6/P7a) and the tier-lock rules.
   Smoke-test the live URL; work the 🟡 rows in `V1.2_TEST_PLAN.md`.
3. **Verify the two watch-items:** signed-in prefs sync persists; run `notify.yml` with
   `dry_run = true`, then a real push (needs `NEXT_PUBLIC_FIREBASE_VAPID_KEY`).
4. **When ready to monetize → Blaze:** provision Google OAuth (P1), deploy functions +
   set Stripe secrets (P5), set `NEXT_PUBLIC_FUNCTIONS_URL` for the live feed (P7b).
   Set a budget alert.

## Known gaps / watch-items

- No `customer.subscription.updated` / refund / dispute handling — only outright
  cancellation downgrades.
- Notifications never confirmed delivered end-to-end (blocked by the secret; now testable
  via dry-run once unblocked).
- `notify.yml` cron is `0 13 * * *` (6am PDT) — revisit at the next DST change.
- GitHub Actions still on Node 20 (deprecation warnings; forced to Node 24 after 2026-06-16).
