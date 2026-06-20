# Solara — Session Handoff

_Last updated: 2026-06-20 (refreshed to record post-handoff notification fixes)_

Zero-context briefing for the next agent. Read this fully, plus
[`status.md`](./status.md) for the one-page state and [`GO_LIVE.md`](./GO_LIVE.md)
for the launch runbook history.

## Project summary

Solara is a personalized UV / outdoor-activity planner: enter location + skin type +
activities, get safe sun windows, a calendar view, push notifications, and Google
Calendar integration.

- **Stack:** Next.js 16 (static export, `output: 'export'`), TypeScript, Tailwind +
  inline styles + `app/globals.css` vars, Firebase (Auth/Firestore/FCM), Vitest.
- **Firebase project:** `uv-activity-planner` (Spark/free plan, Firestore Standard
  edition in `nam5`, production mode).
- **LIVE:** https://uv-activity-planner.web.app (first deploy 2026-06-12). Pushes to
  `main` auto-deploy (`.github/workflows/deploy.yml`: build → hosting → rules).

## State

### Done & verified this session (2026-06-12, third session)

- **Google sign-in + prefs sync VERIFIED on the live site.** The user signed in;
  Auth user + `users/3pvlccfWyCXy9mflDrtKpXH5dll2` doc (nathancwatkins23@gmail.com)
  confirmed via Admin SDK with sensible schema-v2 prefs.
- **User's tier set to `paid` via Admin SDK** (deliberate, user-approved) so they can
  exercise the Pro-gated notifications toggle. Optionally flip back to `free` after
  notifications are proven — ask the user.
- **GA4 live** (`194f1c3`): gtag in `app/layout.tsx` gated on
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` (= `G-XN0QQXMG36`; Actions secret + `.env.local`).
  Env value is regex-validated (`/^G-[A-Z0-9]+$/`) before inline-script interpolation
  (`51efa61`) — keep that guard.
- **Node 24 forcing handled** (`69bc3a0`): `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
  at workflow level in deploy.yml; deploy verified green. June 16 watch-item CLOSED.
- **Activities now require sign-in** (`18116f1` + `51efa61`, user decision):
  anonymous tier limit 0 in `lib/tiers.ts`. Onboarding step 3 for guests = sign-in
  gate + "Skip for now" (no picker). Dashboard activities section for guests = one
  sign-in card; the gate wins even over legacy guest activities saved before the
  policy (PlanAhead/calendar blocks gated too; legacy data is kept and seeds the
  account on sign-in).
- **Guest mobile decluttered** (`03f8bf1` + `51efa61`, user-directed): guests get NO
  Dashboard/Calendar tab bar (`effectiveView` in App.tsx — see Conventions), no day
  tabs, no "Sign in to see tomorrow" pill, no profile pill. Sign-in CTAs for guests
  are ONLY: header button, activities card, notification banner. UV timeline bars
  flex to viewport (no horizontal scroll, ever); per-bar hour labels are
  `hide-mobile` with a 3-point axis row (`show-mobile`); SunArc's axis row is
  `hide-mobile` (the timeline axis below covers it). Location trigger truncates.
- **Code review run + all 7 findings fixed** (`51efa61`): includes `formatUV()` in
  `lib/weather.ts` (compact mode for timeline bars) and shared
  `ACTIVITY_SIGNIN_BLURB` exported from `components/GoogleSignInButton.tsx`.
- **Housekeeping:** deleted stray `~/projects/` (contained only a junk `.next` dev
  cache; the real repo is `~/n8builds/projects/solara` and `~/n8builds/projects/`
  is legitimate — never touch it).
- **Notification production-correctness fixes** (`3962457`, `0b2bf1e`, committed right
  after this handoff was first written; deployed green `27454979134`): notification
  icons now point at real SVG assets; all `NEXT_PUBLIC_SITE_URL` fallbacks point at
  the real domain (`uv-activity-planner.web.app`, not the non-existent
  `solara.web.app`); and the cron computes "today" from the location's UTC offset
  (Open-Meteo `timezone=auto`), fixing the wrong-day forecast for UTC+11/+12 users.

Verification baseline: `npm run typecheck` clean · `npx vitest run` 116/116 ·
`npm run build` succeeds · deploys green · guest mobile verified at 375px with
Playwright (zero horizontal overflow; legacy-guest gate asserted).

### NOT yet done

- **Notifications end-to-end.** User is signed in and Pro-tier but has NOT enabled
  notifications (`users/{uid}` has no `fcmToken` / `notificationsEnabled`). The
  enable banner appears ~4s after dashboard load when browser permission is
  'default' (components/NotificationBanner.tsx via App.tsx).

## Next steps (ordered)

1. **Prove notifications end-to-end** (the last unproven launched feature).
   USER ACTION first: open the live site, click Enable on the 🔔 banner, accept the
   browser prompt. Then: verify the user doc has `fcmToken` + `notificationsEnabled:
   true` (Admin SDK query, see Conventions) → `gh workflow run notify.yml -f
   dry_run=true` → logs must show a built message for them → real send via the 6am PT
   cron (or dispatch without dry_run). 0-user dry-run was green (run `27432692013`).
   Afterwards ask the user whether to flip their tier back to `free`.
2. **Work the 🟡 rows in [`V1.2_TEST_PLAN.md`](./V1.2_TEST_PLAN.md)** against live.
3. **Monetization (when user says go): DECIDED — stay on Firebase.** Upgrade to
   Blaze, deploy `functions/` scaffold (P5 Stripe webhook, P7b live calendar feed).
   Do not revisit Vercel. Don't start without the user.
4. **P1 Google Calendar OAuth** needs an OAuth client ID — bundle with monetization
   (consent-screen work overlaps).

## Conventions & gotchas

- **Commit after every logical change**; trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Push freely — push
  deploys to production.
- **Verify with:** `npm run typecheck` && `npx vitest run` && `npm run build`.
- **Visual verification recipe (works):** `npx --yes serve@latest out -l 4173`, then
  Playwright via global install:
  `NODE_PATH=/home/natkins/.npm-global/lib/node_modules node -e "require('playwright')..."`
  (chromium cached). Seed guest state via `localStorage.setItem('solara_prefs', ...)`
  in `addInitScript` (key in `lib/prefs.ts`). Screenshot at 375×812 and assert
  `scrollWidth - clientWidth === 0`.
- **Admin SDK queries:** service-account JSON at
  `/mnt/c/Users/natha/Downloads/uv-activity-planner-firebase-adminsdk-fbsvc-2907f0225d.json`
  (NEVER commit). `GOOGLE_APPLICATION_CREDENTIALS=<path> node -e` with
  `firebase-admin` (in node_modules). Admin writes to `tier` are the legitimate
  channel (rules block clients).
- **Secrets:** `gh secret set NAME --body "value"`. `.env.local` exists (gitignored).
  `NEXT_PUBLIC_*` baked at build — changing one requires redeploy, and it must be in
  deploy.yml's Build env block or it's dead in prod.
- **Tier limits (`lib/tiers.ts`):** anonymous **0 activities** (activities require
  sign-in — guests get the UV dashboard only; decided 2026-06-12), free 3, paid
  unlimited. Notifications are paid-only. No "Guest" labels anywhere.
- **Guest UX rules (user-set, don't regress):** as few sign-in nags as possible; no
  upsell pills for guests; no horizontal scrollbars on mobile, ever.
- **`effectiveView` in App.tsx:** every render decision must key off `effectiveView`,
  never raw `view` (it's derived because DevPanel tierOverride flips displayTier
  without an auth event). Adding a `view ===` check is a regression.
- **`.show-mobile` / `.hide-mobile`** utilities in globals.css (≤560px breakpoint);
  inline `display` styles defeat them — use the Tailwind `flex` class alongside.
- Firestore rules: clients may never write `tier: 'paid'`. Don't "fix" while
  debugging.
- Profiles (P6) deprioritized. OAuth consent-screen support email = personal Gmail
  for now; revisit at monetization (Workspace on n8builds.dev later).
- `notify.yml` cron `0 13 * * *` = 6am PDT; revisit at DST change.

## File map

| File | Why it matters |
|---|---|
| `docs/status.md` | One-page project state (kept current) |
| `docs/V1.2_TEST_PLAN.md` | Manual test matrix — 🟡 rows still open against live |
| `.github/workflows/deploy.yml` | Push-to-main deploy; Node-24 forced; env block bakes NEXT_PUBLIC_* |
| `.github/workflows/notify.yml` | Daily notification cron; `dry_run` input for testing |
| `scripts/send-notifications.js` | The notification job (DRY_RUN env) |
| `components/App.tsx` | Screen routing, auth listener, `effectiveView` guest gating |
| `components/Onboarding.tsx` | 3-step funnel; step 3 is a sign-in gate for guests |
| `components/Dashboard.tsx` | Hero card, metrics, activities section + guest sign-in card |
| `components/NotificationBanner.tsx` | The Enable-notifications banner (next step 1) |
| `components/GoogleSignInButton.tsx` | Shared sign-in + `ACTIVITY_SIGNIN_BLURB` |
| `components/UVTimeline.tsx` | Flex-fit hour bars + mobile axis (no h-scroll) |
| `lib/tiers.ts` | Tier limits (anonymous=0 activities) + preset catalog |
| `lib/weather.ts` | Display helpers incl. `formatUV` |
| `lib/prefs.ts` | Prefs schema, `solara_prefs` localStorage key, Firestore persistence |
| `functions/` | Blaze-only scaffold: Stripe webhook + live feed (NOT deployed) |
