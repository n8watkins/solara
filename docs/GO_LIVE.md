# Solara — Go-Live Runbook

One ordered checklist to take the current `main` from "built" to "live." Stages are
sequenced so each one is independently shippable: you can stop after Stage 1 and have a
working product, then turn on the Blaze features later.

Companion docs: `DEPLOYMENT.md` (Spark-vs-Blaze + env reference), `V1.2_TEST_PLAN.md`
(manual QA matrix), `ROADMAP_V1.2_V2.md` (what each phase is).

Legend: `[ ]` you do it · `(auto)` CI does it · `(ops)` external console, runs as `! <cmd>`.

---

## Stage 0 — Pre-flight (local, no deploy)

- [x] `npm run typecheck` — clean
- [x] `npx vitest run` — 114 passing
- [x] `npm run build` — static export succeeds
- [ ] `git log origin/main..HEAD --oneline` — confirm the commits you expect are present
### 🔴 BLOCKER — configure GitHub Actions secrets first

As of 2026-06-06 the repo has **no Actions secrets set**, so `deploy.yml` builds fine but
fails at the Hosting-deploy step, and `notify.yml` fails on an empty service account. The
build also silently bakes empty `NEXT_PUBLIC_*` values (the app would be a static shell
with auth/Firestore off). Set these before the first real deploy.

**Required** (deploy + the app actually working):
```bash
# Service-account JSON: Firebase console → Project settings → Service accounts →
# Generate new private key. This one secret powers Hosting deploy, rules deploy, and notifications.
gh secret set FIREBASE_SERVICE_ACCOUNT < ~/Downloads/<project>-firebase-adminsdk.json

# Web SDK config: Firebase console → Project settings → General → Your apps → SDK setup.
gh secret set NEXT_PUBLIC_FIREBASE_API_KEY
gh secret set NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
gh secret set NEXT_PUBLIC_FIREBASE_PROJECT_ID
gh secret set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
gh secret set NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
gh secret set NEXT_PUBLIC_FIREBASE_APP_ID
```

**For push notifications** (P4): `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Cloud Messaging → Web
Push certificates) and optionally `NEXT_PUBLIC_SITE_URL`.

**Optional flip-ons** (each gates a feature; absent = UI hidden, deploy still succeeds):
`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`,
`NEXT_PUBLIC_PRO_PRICE`, `NEXT_PUBLIC_FUNCTIONS_URL`.

- [ ] `gh secret list` shows the six required + `FIREBASE_SERVICE_ACCOUNT` before pushing.

## Stage 1 — Ship the Spark baseline (V1.2 + P6/P7a)

This is everything that does **not** need Blaze: forecast, activities, routines, cloud
sensitivity, multi-location, profiles, and one-shot `.ics` export.

- [ ] `git push origin main`
- [ ] (auto) `deploy.yml` runs: builds the static export, deploys Hosting, **and deploys
      `firestore.rules`** (including the new tier-lock).
- [ ] Smoke test the live URL: onboarding → add activity → see windows → switch day →
      change location → add a profile → export `.ics` and open the file.
- [ ] Work the 🟡 rows in `V1.2_TEST_PLAN.md` on the deployed build.

## Stage 2 — Verify the two watch-items

**2a. Firestore prefs sync for signed-in users** (the `ignoreUndefinedProperties` fix)
- [ ] Sign in with Google on the live site, change a setting, reload → setting persisted.
- [ ] In the Firebase console, open your `users/{uid}` doc and confirm it updated without
      an error. (Before the fix, writes with absent optional fields could throw silently.)

**2b. Notifications end-to-end** — now testable safely via dry-run.
- [ ] GitHub → Actions → "Send morning notifications" → **Run workflow** with
      `dry_run = true`. Read the logs: it should query users, fetch forecasts, and log a
      built message per user **without sending anything**.
- [ ] When the dry-run looks right, enable notifications on a real device, then Run
      workflow with `dry_run = false` and confirm the push arrives.
- [ ] Dead/unregistered tokens are now auto-cleared on send; no manual cleanup needed.

## Stage 3 — Blaze-gated features (optional, do when ready to monetize)

Upgrade the project to **Blaze** first and set a **budget alert** (~$5/mo). Spark stays
free; Blaze just adds the metered headroom Cloud Functions need.

**3a. Calendar (P1)** — client-only OAuth, technically Spark-safe but grouped here.
- [ ] (ops) Create an OAuth 2.0 Web client in Google Cloud; add the live origin to
      Authorized JavaScript origins.
- [ ] Set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`, re-deploy → the "Connect calendar" UI
      un-gates. Verify free/busy scheduling and event booking.

**3b. Stripe monetization (P5)**
- [ ] (ops) Create a Stripe **Payment Link**; set `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` +
      `NEXT_PUBLIC_PRO_PRICE`.
- [ ] `cd functions && npm install` (separate runtime).
- [ ] (ops) `firebase functions:secrets:set STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- [ ] (ops) `firebase deploy --only functions` (needs the `functions` block in
      `firebase.json` — present). Register the deployed `stripeWebhook` URL in Stripe;
      paste its signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Test in Stripe **test mode**: complete a checkout → `users/{uid}.tier` flips to
      `paid`; cancel the subscription → it flips back to `free`.
- [ ] Confirm the tier-lock: from the browser console, a signed-in user trying
      `setDoc(userRef,{tier:'paid'},{merge:true})` is **rejected** by the rules.

**3c. Live calendar feed (P7b)**
- [ ] `firebase deploy --only functions` also deploys `calendarFeed`.
- [ ] Set `NEXT_PUBLIC_FUNCTIONS_URL` to the functions base URL, re-deploy → the
      Subscribe UI un-gates (signed-in users only).
- [ ] Create a feed link, subscribe a calendar app to it, confirm it refreshes as the
      forecast changes. Regenerate the link → old subscription stops updating.

## Stage 4 — Post-launch

- [ ] Budget alert active on Blaze (if Stage 3 done).
- [ ] Note: `customer.subscription.deleted` is the only downgrade path — there is no
      uid↔customer mapping beyond `stripeCustomerId`, so refunds/disputes aren't handled.
- [ ] `notify.yml` cron is `0 13 * * *` (6am PDT). Revisit at the next DST change.
