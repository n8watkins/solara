# Solara — Deployment Guide

_Last updated: 2026-05-29_

## Spark or Blaze?

The app was deliberately architected to run on the **Spark (free)** plan. Check your
current plan at **Firebase Console → ⚙️ → Usage and billing → Details & settings**.

| Service used | Plan needed | How it's wired |
|---|---|---|
| Hosting (static `out/`) | ✅ Spark | `firebase.json` |
| Auth (Google sign-in) | ✅ Spark | `lib/firebase.ts` |
| Firestore (prefs, FCM tokens) | ✅ Spark | `firestore.rules` |
| FCM push notifications | ✅ Spark | sent from **GitHub Actions cron** (`notify.yml`), not Cloud Functions |
| Cloud Functions | ❌ **Blaze** | _none exist yet_ |

**As built today, Spark is enough — $0/mo.** The daily notification job runs on GitHub
Actions with `firebase-admin`, which avoids Cloud Functions / Cloud Scheduler — the usual
trigger for needing Blaze.

**What flips you to Blaze:** real monetization. The Stripe webhook that auto-grants `paid`
after payment *must* be a Cloud Function, and Cloud Functions require Blaze. Blaze keeps the
entire Spark free tier and adds ~2M free function calls/month, so a low-volume webhook costs
effectively **$0** — just attach a billing account and set a budget alert.

> The same applies if the planned **Google Calendar scheduling** feature ever needs a
> server-side token exchange or a Calendar push-notification webhook. The client-only design
> (see `docs/SMART_SCHEDULING.md`) stays on Spark; a server component would require Blaze.

---

## Phase 0 — Decide the plan

- **Launch without auto-billing → stay on Spark.** Payment Links still work; buyers are
  flipped to Pro manually (or you collect waitlist only).
- **Launch with auto-billing → upgrade to Blaze**, and set a **budget alert** (e.g. $5/mo)
  so there are no surprises.

## Phase 1 — Firebase project setup

- [ ] Create the Firebase project (or confirm the existing one).
- [ ] Replace `YOUR_FIREBASE_PROJECT_ID` in **`.firebaserc`** (still a placeholder).
- [ ] Enable **Auth → Google** provider; add the deploy domain to authorized domains.
- [ ] Enable **Firestore** in production mode (`firestore.rules` already locks it per-user).
- [ ] Enable **Cloud Messaging**; generate a **Web Push (VAPID) key**.

## Phase 2 — Secrets (GitHub → repo → Settings → Secrets)

`deploy.yml` and `notify.yml` already reference these — they must exist:

- [ ] `NEXT_PUBLIC_FIREBASE_API_KEY`
- [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- [ ] `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- [ ] `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- [ ] `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- [ ] `NEXT_PUBLIC_FIREBASE_APP_ID`
- [ ] `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
- [ ] `FIREBASE_SERVICE_ACCOUNT` (JSON — hosting deploy + the notify cron)
- [ ] `NEXT_PUBLIC_SITE_URL` (absolute URL for OG/Twitter share images)
- [ ] _Monetization (optional):_ `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`, `NEXT_PUBLIC_PRO_PRICE`
- [ ] _Calendar scheduling (optional):_ `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` — OAuth
      client ID from a Google Cloud project with the Calendar API enabled and the
      deploy domain as an authorized JS origin. Stays on Spark (client-only reads).

## Phase 3 — First deploy

- [ ] **Fix the CI gap:** `action-hosting-deploy` deploys **Hosting only** — Firestore rules
      are never deployed by CI. Either run `firebase deploy --only firestore:rules` once
      manually, or add that step to the workflow. _Without this the DB can sit on
      default-open rules — a security hole._
- [ ] `npm run build` locally to confirm the static export.
- [ ] Push to `main` → confirm `deploy.yml` succeeds → site is live.

## Phase 4 — Verify in production (not localhost)

- [ ] Google sign-in round-trips; prefs sync to Firestore.
- [ ] PWA installs (manifest + PNG/maskable icons); home-screen icon renders correctly.
- [ ] Share a link → OG card renders (needs `NEXT_PUBLIC_SITE_URL` + `metadataBase`).
- [ ] FCM: register a token in a real browser, `workflow_dispatch` `notify.yml`, confirm
      delivery. _(Never tested end-to-end — see ROADMAP.)_

## Phase 5 — Monetization (Blaze only)

The webhook is **scaffolded** in `functions/` (`stripeWebhook`); these steps deploy and wire it.

- [ ] Create the Stripe **Payment Link**; set `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`.
- [ ] `cd functions && npm install` (separate runtime; not part of the app's deps).
- [ ] Set secrets: `firebase functions:secrets:set STRIPE_SECRET_KEY` and
      `STRIPE_WEBHOOK_SECRET`.
- [ ] `firebase deploy --only functions` (needs the `functions` block now in
      `firebase.json`). Register the deployed `stripeWebhook` URL in Stripe; copy the
      signing secret into `STRIPE_WEBHOOK_SECRET`. Test in Stripe **test mode**.
- [x] **Tier self-grant is locked** in `firestore.rules`: clients may set any non-paid
      tier, but only the webhook's Admin SDK may write `tier == 'paid'`. Without this the
      webhook is pointless (any user could self-upgrade from the console).

## Phase 7b — Live calendar feed (Blaze only)

Both halves exist: the `calendarFeed` function in `functions/`, and the client wiring
(`lib/feed.ts`, `components/CalendarFeed.tsx`, the `calendarFeedToken` pref).

- [ ] `firebase deploy --only functions` deploys `calendarFeed` alongside the webhook.
- [ ] Set `NEXT_PUBLIC_FUNCTIONS_URL` to the functions base URL (e.g.
      `https://<region>-<project>.cloudfunctions.net`) so the Subscribe UI un-gates.
- [ ] Verify: subscribe a calendar app to the generated URL; confirm it refreshes as the
      forecast changes. Note the feed only works for **signed-in** users (the token must be
      persisted to Firestore for the function to resolve it).

---

## Known gaps to address before/at launch

1. **CI does not deploy Firestore rules** (Phase 3) — _fixed_: `deploy.yml` now deploys
   `firestore:rules`.
2. **Notifications never tested end-to-end** (Phase 4).
3. **Pro fulfilment**: webhook scaffolded (Phase 5) but not yet deployed/tested in Stripe.
4. **Subscription lifecycle**: the webhook grants Pro on `checkout.session.completed` and
   revokes it on `customer.subscription.deleted` (via the persisted `stripeCustomerId`).
   Both paths are still untested against live Stripe events.

## Quick commands

```bash
npm run build                              # static export to out/
firebase deploy --only hosting             # manual hosting deploy
firebase deploy --only firestore:rules     # deploy security rules (CI gap)
firebase deploy                            # everything in firebase.json
```
