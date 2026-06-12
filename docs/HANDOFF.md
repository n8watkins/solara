# Solara — Session Handoff

_Last updated: 2026-06-12 (post-launch session)_

Zero-context briefing for the next agent. Read this fully, plus
[`status.md`](./status.md) for the one-page state and [`GO_LIVE.md`](./GO_LIVE.md)
for the launch runbook history.

## Project summary

Solara is a personalized UV / outdoor-activity planner: enter location + skin type +
activities, get safe sun windows, a calendar view, push notifications, and Google
Calendar integration.

- **Stack:** Next.js 16 (static export, `output: 'export'`), TypeScript, Tailwind-ish
  inline styles + `app/globals.css` vars, Firebase (Auth/Firestore/FCM), Vitest.
- **Firebase project:** `uv-activity-planner` (Spark/free plan, Firestore Standard
  edition in `nam5`, production mode).
- **LIVE:** https://uv-activity-planner.web.app — first successful deploy happened
  this session (2026-06-12). Deploys run automatically on push to `main`
  (`.github/workflows/deploy.yml`: build → hosting → Firestore rules).

## State

### Done & verified this session

Infra (the launch itself):
- All GitHub Actions secrets set via `gh secret set`: six `NEXT_PUBLIC_FIREBASE_*`,
  `NEXT_PUBLIC_SITE_URL` (= https://uv-activity-planner.web.app), `NEXT_PUBLIC_PRO_PRICE`,
  `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, `FIREBASE_SERVICE_ACCOUNT`.
- Firestore database created (Standard, `nam5`, production mode).
- IAM: `firebase-adminsdk-fbsvc@uv-activity-planner.iam.gserviceaccount.com` was granted
  **Service Usage Consumer** + **Firebase Rules Admin** so CI can deploy rules.
  (IAM propagation took ~10 min; `testIamPermissions` confirmed before it took effect.)
- Deploy workflow fully green: hosting + security rules deployed. Site smoke-tested (200).
- `.firebaserc` points at the real project (`7889853`). Workflows on actions v5 /
  Node 24 (`dd7c18a`).

Product (user-directed UI/funnel rework, all committed + deployed):
- `ee01095` Onboarding step 3 = curated 8-preset grid + inline custom; Google sign-in
  CTA in onboarding; header de-Guested (Google button / avatar, Pro-only badge);
  **bugfix:** sign-in no longer clobbers existing cloud prefs with local guest state;
  **bugfix:** mid-onboarding sign-in no longer bounces to welcome screen.
- `9885c77` Dashboard: UV-by-hour hero card at top w/ current UV + temp; new
  `showSunPath` pref gates the SunArc.
- `05fc6b7` Settings: 860px modal, left-nav rail (Sun profile / Appearance / Activities
  / Location / Account), sun-path toggle under Appearance, `TIER_LABELS` removed.
- `375d844` Activity cards: safe windows stack vertically w/ 🌅/☀️/🌇 time-of-day cues;
  edit = pencil top-right.
- `7544cd4` Activity modal shell 820px, edit form two-column grid.
- `3121c16` CSS: accent-colored range/checkbox/radio, select focus, focus-visible rings.

Verification baseline: `npm run typecheck` clean · `npx vitest run` 114/114 ·
`npm run build` succeeds. All commits pushed to `origin/main`.

### Verified 2026-06-12 (second pass)

- **Firebase Auth is NOT provisioned — confirmed, blocking.** Both the public
  `getProjectConfig` endpoint and the admin `admin/v2/projects/.../config` endpoint
  (service-account credentials) return `CONFIGURATION_NOT_FOUND`. Authentication has
  never been initialized for the project, so any sign-in attempt on the live site
  fails with `auth/configuration-not-found`. **User action required:** Firebase
  console → Authentication → Get started → Sign-in method → enable **Google**.
  (Deliberately did NOT call the Identity Platform `initializeAuth` API — that
  upgrades the project to GCIP, a product-tier change the user hasn't approved.)
- **Notification pipeline proven as far as possible without users.** Dispatched
  `gh workflow run notify.yml -f dry_run=true` (run `27432692013`): workflow green,
  service account authenticated, Firestore queried — "Found 0 users with
  notifications enabled. Dry run complete. 0 message(s) built." Remaining unproven:
  message build + FCM send, which needs a signed-in user with notifications on
  (blocked on Auth above).
- **Live bundle config is correct.** `firebase-messaging-sw.js` on the live site has
  the full correct Firebase config baked (generated at build time by
  `scripts/generate-sw.js` from the same env as the app bundles), so sign-in will
  work as soon as the provider is enabled — no redeploy needed.

### NOT yet verified

1. **Google sign-in flow + prefs sync on the live site** — blocked on the user
   enabling Authentication/Google provider in the console (see above).
2. **Notifications end-to-end (FCM send).** Once a signed-in user has enabled
   notifications on the live site, re-run `gh workflow run notify.yml -f dry_run=true`
   to see the built message, then let the real cron fire.

## Next steps (ordered)

1. ~~USER: enable Authentication in the Firebase console~~ ✅ Done 2026-06-12:
   `google.com` provider `enabled: true` (auto-provisioned OAuth client), both
   live domains in `authorizedDomains` — verified via admin API.
2. **Verify live sign-in + prefs sync** (now unblocked). Open the site, complete
   onboarding, sign in with Google, confirm a `users/{uid}` doc appears in Firestore
   and prefs survive a reload on another device/profile. No redeploy needed — the
   live bundle config is verified correct.
3. **Prove notifications end-to-end.** Enable notifications as a real user → run
   `gh workflow run notify.yml -f dry_run=true` → check logs show the built message →
   then let the real 6am PT cron fire (or dispatch without dry_run). (Dry-run with
   0 users already verified green on 2026-06-12.)
4. **June 16, 2026:** GitHub forces Node 24 on JS actions. Our steps are v5/Node24
   already; `FirebaseExtended/action-hosting-deploy@v0` is third-party and still
   flagged. Glance at the first deploy after the 16th.
5. **Work the 🟡 rows in [`V1.2_TEST_PLAN.md`](./V1.2_TEST_PLAN.md)** against the live site.
6. **Monetization (when user says go): DECIDED 2026-06-12 — stay on Firebase.**
   User explicitly chose to stick with Firebase rather than port to Vercel ("let's
   just stick with Firebase for this project"). Path: upgrade to Blaze, deploy the
   existing `functions/` scaffold (P5 Stripe webhook, P7b live calendar feed).
   Do not revisit the Vercel option. Don't start this without the user.

## Conventions & gotchas

- **Commit after every logical change**; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Push freely — push deploys to production.
- **Verify with:** `npm run typecheck` && `npx vitest run` && `npm run build`.
- **Secrets:** set via `gh secret set NAME --body "value"`. The service-account JSON
  lives at `/mnt/c/Users/natha/Downloads/uv-activity-planner-firebase-adminsdk-fbsvc-2907f0225d.json`
  (NEVER commit; also used as `GOOGLE_APPLICATION_CREDENTIALS` for local
  `npx firebase-tools deploy --only firestore:rules`).
- `.env.local` exists locally (gitignored) with the real Firebase config.
- `NEXT_PUBLIC_*` values are **baked at build time** — changing one requires a redeploy.
- Firestore rules: clients may never write `tier: 'paid'` (only the Stripe webhook /
  Admin SDK). Don't "fix" that while debugging.
- Tier limits (`lib/tiers.ts`): anonymous 1 activity (deliberate funnel), free 3,
  paid unlimited. User decided: no "Guest" labels anywhere; funnel to Google accounts.
- Profiles (P6 family/pet) are deprioritized — user explicitly not interested in
  expanding them.
- Known minor bug (punt): `scripts/send-notifications.js` computes "today" in runner
  UTC while Open-Meteo returns location-local hours — users in UTC+11/+12 can get a
  "no forecast" push. Only matters with international users.
- `notify.yml` cron `0 13 * * *` = 6am PDT; revisit at DST change.

## File map

| File | Why it matters |
|---|---|
| `docs/status.md` | One-page project state (kept current) |
| `docs/GO_LIVE.md` | Launch runbook (Stage 0 done; later stages = Blaze/monetization) |
| `docs/V1.2_TEST_PLAN.md` | Manual test matrix — 🟡 rows still open against live |
| `.github/workflows/deploy.yml` | Push-to-main → build + hosting + rules deploy |
| `.github/workflows/notify.yml` | Daily notification cron; `dry_run` input for testing |
| `scripts/send-notifications.js` | The notification job (importable; DRY_RUN env) |
| `components/App.tsx` | Screen routing, auth listener, weather fetch |
| `components/Onboarding.tsx` | 3-step funnel incl. Google CTA + starter activities |
| `components/Header.tsx` | Top bar: location, settings, Google sign-in/avatar |
| `components/GoogleSignInButton.tsx` | Shared sign-in (seeds new accounts, never clobbers) |
| `components/Dashboard.tsx` | UV hero card, metrics, activities section |
| `components/ActivityCards.tsx` | Per-activity safe-window cards (vertical rows) |
| `components/PreferencesModal.tsx` | Left-nav settings modal |
| `lib/tiers.ts` | Tier limits + preset activity catalog |
| `lib/prefs.ts` | Prefs schema/normalization, local + Firestore persistence |
| `firestore.rules` | Security rules (tier-lock) |
| `functions/` | Blaze-only scaffold: Stripe webhook + live calendar feed (NOT deployed) |
