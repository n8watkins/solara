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

- [ ] Create the Stripe **Payment Link**; set `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`.
- [ ] Write the **Stripe webhook Cloud Function**: on `checkout.session.completed`, read
      `client_reference_id` (the uid `lib/billing.ts` already attaches) → set
      `users/{uid}.tier = 'paid'`.
- [ ] Deploy functions; register the webhook URL in Stripe; test in Stripe test mode.

---

## Known gaps to address before/at launch

1. **CI does not deploy Firestore rules** (Phase 3) — security risk.
2. **Notifications never tested end-to-end** (Phase 4).
3. **Pro fulfilment is manual** until the Stripe webhook exists (Phase 5).

## Quick commands

```bash
npm run build                              # static export to out/
firebase deploy --only hosting             # manual hosting deploy
firebase deploy --only firestore:rules     # deploy security rules (CI gap)
firebase deploy                            # everything in firebase.json
```
