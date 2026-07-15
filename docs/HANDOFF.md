# Solara — Session Handoff

> **Archived historical snapshot**
>
> This document records the state of the `mobile-uv-ab-arc` branch on 2026-06-20 and no longer describes the current implementation, deployment process, notification model, test baseline, or release plan.
> Use [status.md](./status.md) for the current implementation state, [DEPLOYMENT.md](./DEPLOYMENT.md) for configuration and activation, and [GO_LIVE.md](./GO_LIVE.md) for release verification.
> Do not use commands, credentials, branch directions, or operational instructions below without revalidating them against the current repository and `AGENTS.md`.

_Last updated: 2026-06-20 (interactive UV redesign + sun-path A/B + mandatory sign-in — branch `mobile-uv-ab-arc`, PREVIEW-ONLY, NOT in production)_

Zero-context briefing for the next agent. Read this fully, plus
[`status.md`](./status.md) for the one-page state and [`GO_LIVE.md`](./GO_LIVE.md)
for the launch runbook history.

> ## ⚠️ READ FIRST — branch status (preview only, not in production)
>
> The latest wave of work is on branch **`mobile-uv-ab-arc`** (9 commits ahead of
> `main`) and is **NOT merged and NOT deployed.** Production
> (https://uv-activity-planner.web.app) still serves the EARLIER mobile-first wave.
>
> - **Preview channel (the chosen sun-path design):**
>   https://uv-activity-planner--uv-arc-apa3pw9t.web.app
> - **What changed:** the UV card is now an interactive scrollable/tappable hour strip
>   synced to an interactive sun path; sign-in is **mandatory** (the guest funnel is
>   REVERSED); Settings is full-screen on mobile; A/B decided in favour of the sun-path.
> - **Before merge:** bug review + **real-device verification** are PENDING. The
>   signed-in dashboard could NOT be auto-screenshotted this session (mandatory sign-in
>   has no headless guest path), so it must be checked by hand on a device.

## Project summary

Solara is a personalized UV / outdoor-activity planner: enter location + skin type +
activities, get safe sun windows, a calendar view, push notifications, and Google
Calendar integration.

- **Stack:** Next.js 16 (static export, `output: 'export'`), TypeScript, Tailwind +
  inline styles + `app/globals.css` vars, Firebase (Auth/Firestore/FCM), Vitest.
- **Firebase project:** `uv-activity-planner` (Spark/free plan, Firestore Standard
  edition in `nam5`, production mode).
- **LIVE (production):** https://uv-activity-planner.web.app (first deploy 2026-06-12).
  Pushes to `main` auto-deploy (`.github/workflows/deploy.yml`: build → hosting → rules).
  Production currently = the mobile-first wave; the `mobile-uv-ab-arc` redesign is NOT
  on it yet.
- **PREVIEW (branch `mobile-uv-ab-arc`):**
  https://uv-activity-planner--uv-arc-apa3pw9t.web.app — the new sun-path design,
  preview-only, awaiting bug review + device verification before merge.

## State

### Done this session (2026-06-20, interactive-UV + sun-path A/B) — branch `mobile-uv-ab-arc`, PREVIEW-ONLY, not merged/deployed

9 commits ahead of `main` (`git log main..HEAD`). All preview-only on channel
`uv-arc-apa3pw9t`. **Not in production.** Bug review + device verification pending.

- **Interactive UV redesign** (`89bfab4` uv-A, then `45ff545` uv-B): the old
  fit-to-width UV bars + static sun arc are gone. The UV card is now a
  horizontally-scrollable, zoomed, tappable **UV strip** (`.uv-strip` in globals.css):
  fixed-width bars, current hour auto-centered + ring-highlighted, tap any hour to pin
  its detail. UV **numbers are non-selectable** — this fixes a tap-to-Google bug where
  long-press selected the number and the OS offered "search Google". uv-B then
  reintroduced a compact **interactive SunArc** above the strip, synced via a shared
  `focusedHour` lifted into Dashboard (`components/Dashboard.tsx`): both SunArc and
  UVTimeline take controlled `focused`/`onSelectHour` props; arc markers evaluate the
  same quadratic bezier the curve is drawn from (`M 34 118 Q 160 12 286 118`) so x maps
  1:1 to the hour and the arc reads in lockstep with the strip. UVTimeline stays
  uncontrolled (local tap state) if the props are omitted.
- **UV-card polish** (`1c89d5d`): consolidated to ONE focused-hour readout (the card
  header reflects the shared focus — UV · temp · condition · label); horizontal
  **strip ↔ arc scroll-sync** (rAF-debounced; the bar nearest the strip center focuses;
  programmatic-scroll + same-hour guards avoid feedback loops); arc stroke is a per-hour
  **`uvColorHex` gradient**; smaller burn-time / vitamin-D cards; tighter swipeable
  `TipCarousel` (scroll-snap track + synced dots); arc gated on `prefs.showSunPath !==
  false`.
- **Settings + chrome** (`75aa29b`): `PreferencesModal` is **full-screen on phones**
  (≤640px, 100dvh + safe-area insets) and a centered **modal on desktop** — overlay /
  card / topbar / footer moved to `.settings-*` CSS classes so one media query fills the
  viewport; fixed asymmetric `.settings-content` / `.settings-nav` padding (even L/R).
  Added **`lib/useBodyScrollLock.ts`** — SSR-safe, effect-only, **ref-counted** for
  nested overlays, restores on unmount — wired into `PreferencesModal` and
  `ActivityModalShell`. Header's standalone "⚙️ Settings" + "Sign out" replaced by a
  single **avatar control** (photoURL, or accent circle with the initial) opening a
  dropdown (account name/email, Settings → reuses `showPrefs`, Sign out); closes on
  outside-click / Escape; Pro badge kept.
- **MANDATORY Google sign-in** (`2f451eb`) — **REVERSES the prior guest-funnel work
  (`18116f1`/`03f8bf1`).** In `components/App.tsx` a signed-out visitor never reaches the
  dashboard and there is no local-prefs fallback into the app; signed-in-with-no-prefs
  seeds from onboarding data. `components/Onboarding.tsx` rebuilt to end at a
  **required** Google sign-in (no "Skip for now"), dropped the activity-selection step
  and all the "free with Google / 3 activities / calendar sync" marketing, locks page
  scroll during setup, pins each step's primary CTA to the bottom thumb zone.
- **Marketing strip + arc-off build flag** (`9f1d9d0`): `components/Welcome.tsx` drops
  the "No sign-up required" line + feature pills (CTA → "Get started"); new
  **`NEXT_PUBLIC_HIDE_SUNPATH`** env flag gates the sun path in Dashboard so one codebase
  ships both arc-on and arc-off preview builds. (Effective gate in Dashboard:
  `process.env.NEXT_PUBLIC_HIDE_SUNPATH !== '1' && prefs.showSunPath !== false`.)
- **Consolidated readout + bigger arc + modal day picker** (`17b3e76`): UV card
  restructured top→bottom — one **fixed-height readout pinned at the TOP** (two-row:
  big UV number + label, then temp/condition/burn on its own fixed line) so a long label
  ("Very high") no longer hides the temp or jumps the card height (fixes a temp-hidden /
  card-jump bug). Removed the **Share** button, the "Peak X at Ypm" line, and the dead
  `shareSunWindow` handler. Bigger **`.sun-arc-plot`** (desktop + mobile) with ~3h hour
  ticks and the day's peak marked **on the arc** (it left the header). Day picker no
  longer scrolls horizontally: **Today + Tomorrow + a "More days" button** opening a
  vertical modal (`ActivityModalShell` → `useBodyScrollLock`) listing accessible days
  (locked days show the upgrade hint inside); Refresh kept. Activities header = single
  **"+ Add Activity" (left)** + **"Manage" (right)** via space-between.

**A/B DECISION:** the **sun-path design WON** the arc-vs-no-arc A/B and is the chosen
direction — kept, with a settings toggle to hide the arc (`prefs.showSunPath`; plus the
`NEXT_PUBLIC_HIDE_SUNPATH` build flag used to produce the no-arc preview).

Verification baseline (this session): `npm run typecheck` clean · `npx vitest run`
116/116 · `npm run build` succeeds · deployed to the **preview channel** only (not
`main`). The signed-in dashboard was NOT auto-screenshotted — mandatory sign-in removes
the headless guest path, so device verification is owed.

### Done & verified prior session (2026-06-20, mobile-first redesign) — IN PRODUCTION

- **iOS Safari install hint** (`b8cd343`, `components/InstallPrompt.tsx`): Chromium's
  `beforeinstallprompt` never fires on iOS and iOS only allows web push for
  home-screen-installed PWAs, so iOS Safari users now see manual "Share → Add to Home
  Screen" instructions instead of a dead install button. This is the iOS entry point
  for enabling push.
- **Header rebuilt so it never collides on phones** (`164f545`,
  `components/Header.tsx` + new `.hdr-*` classes in `app/globals.css`): the signed-in
  header used to clip the "Solara" logo and overlap the Pro badge with the city name on
  phones. The location pill now wraps to its own full-width row at ≤560px; desktop
  stays a single flex row (logo | location flex:1 truncates | controls), unchanged.
- **Sticky compact top-tabs nav** (`e650799`, `components/App.tsx`): header and the
  Dashboard/Calendar tabs are wrapped in one sticky container so the nav stays pinned
  while content scrolls.
- **Dashboard mobile-first pass** (`8422928`, `components/Dashboard.tsx`): a "best
  window today" hero card at the top (icon · time · peak UV · "Safe now" badge); the
  standalone "Plan ahead" section is merged INTO the Activities section as a "Best day
  this week" sub-section (`components/PlanAhead.tsx` retitled); tighter phone density
  via a new `.dash-stack` class (gap 18px→13px at ≤560px). Desktop layout preserved.
- **Enable-notifications control in Preferences** (`components/PreferencesModal.tsx`):
  the settings modal now has an "Enable notifications" button (General tab,
  `handleEnableNotifications` → `requestNotificationPermission` + `saveFCMToken`),
  so users can turn on push outside the one-time 🔔 banner. SSR-safe `notifState`
  machine ('unknown'|'enabled'|'blocked'|'default') reads `Notification.permission`
  only in a `useEffect`.

Verification baseline (this session): `npm run typecheck` clean · `npx vitest run`
116/116 · `npm run build` succeeds · all four commits pushed and deployed green.

### Done & verified (2026-06-12, third session)

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

- **Merge / deploy the `mobile-uv-ab-arc` wave.** It is preview-only; bug review +
  real-device verification are owed before it merges to `main` (which deploys to prod).
- **Device-verify the redesign.** Mandatory sign-in blocked the headless screenshot, so
  the signed-in dashboard (UV strip ↔ sun-path scroll-sync, full-screen mobile Settings,
  profile-avatar dropdown, Today/Tomorrow/"More days" picker, mandatory onboarding
  sign-in) is unverified on a real device.
- **Pending UI follow-ups on the branch:**
  - **Activity cards** still want a compact / collapsible / category treatment.
  - A per-hour **"share this time"** feature is wanted (the old global Share button was
    removed in `17b3e76` — replace it with a per-hour share, not the global one).
- **Notifications end-to-end.** User is signed in and Pro-tier but has NOT enabled
  notifications (`users/{uid}` has no `fcmToken` / `notificationsEnabled`). Two enable
  paths now: the 🔔 banner ~4s after dashboard load when browser permission is
  'default' (components/NotificationBanner.tsx via App.tsx), and the new "Enable
  notifications" button in the Preferences modal (components/PreferencesModal.tsx).

## Next steps (ordered)

1. **Verify `mobile-uv-ab-arc` on a real device, then bug-review + merge.** Sign in on
   the preview (https://uv-activity-planner--uv-arc-apa3pw9t.web.app) and exercise the
   UV strip ↔ sun-path scroll-sync, full-screen mobile Settings + avatar dropdown,
   Today/Tomorrow/"More days" picker, and the mandatory onboarding sign-in. Confirm with
   the user that **mandatory sign-in is intended** (it reverses the prior guest funnel).
   The merge and deployment direction recorded here is historical and must not be followed.
   Address the pending follow-ups (compact activity cards; per-hour "share this time").
2. **Prove notifications end-to-end** (the last unproven launched feature).
   USER ACTION first: open the live site, click Enable on the 🔔 banner, accept the
   browser prompt. Then: verify the user doc has `fcmToken` + `notificationsEnabled:
   true` (Admin SDK query, see Conventions) → `gh workflow run notify.yml -f
   dry_run=true` → logs must show a built message for them → real send via the 6am PT
   cron (or dispatch without dry_run). 0-user dry-run was green (run `27432692013`).
   Afterwards ask the user whether to flip their tier back to `free`.
3. **Work the 🟡 rows in [`V1.2_TEST_PLAN.md`](./V1.2_TEST_PLAN.md)** against live.
4. **Monetization (when user says go): DECIDED — stay on Firebase.** Upgrade to
   Blaze, deploy `functions/` scaffold (P5 Stripe webhook, P7b live calendar feed).
   Do not revisit Vercel. Don't start without the user.
5. **P1 Google Calendar OAuth** needs an OAuth client ID — bundle with monetization
   (consent-screen work overlaps).

## Conventions & gotchas

- **Historical note:** The commit and push instructions that were recorded in this snapshot are retired.
  Follow the current repository `AGENTS.md` and obtain the user's authorization before pushing.
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
- **Mobile layout conventions (≤560px breakpoint, globals.css):** `.hdr-*` classes
  drive the header — desktop is one flex row (logo | location flex:1 truncates |
  controls); at ≤560px the location pill wraps to its own full-width row so nothing
  collides. `.dash-stack` sets the Dashboard's vertical gap (18px desktop → 13px at
  ≤560px). The Dashboard leads with a "best window today" hero card (icon · time ·
  peak UV · "Safe now" badge) above the metrics. Header + Dashboard/Calendar tabs live
  in one sticky container (App.tsx) so the nav stays pinned on scroll. Desktop layout
  must stay unchanged when touching these.
- **PlanAhead is nested inside Activities** as the "Best day this week" sub-section —
  it is no longer a standalone Dashboard section (the guest activity gate still covers
  it).
- **[branch `mobile-uv-ab-arc`] Mandatory sign-in — NO guest mode.** On this branch
  `components/App.tsx` admits only signed-in users (no local-prefs fallback into the
  app); the guest UV-only dashboard / `effectiveView` guest gating from the prior wave
  is REVERSED. Onboarding ends at a required Google sign-in (no skip). Several
  guest-only conventions above (guest UX rules, `effectiveView` guest gating, anonymous
  tier as the in-app path) are therefore moot on this branch — but they still describe
  production, so don't delete them until this merges. Verifying screenshots now requires
  a real sign-in (the headless `localStorage` seed no longer reaches the dashboard).
- **[branch `mobile-uv-ab-arc`] UV card conventions (globals.css):** `.uv-strip` is the
  horizontally-scrollable, zoomed hour strip (fixed-width bars, current hour
  auto-centered + ring-highlighted, **non-selectable numbers** — keep them
  non-selectable or the tap-to-Google bug returns). `.sun-arc-plot` sizes the
  interactive `SunArc` (bigger desktop + mobile, ~3h ticks, peak marked on the arc). The
  strip and arc share a single **`focusedHour`** lifted into `components/Dashboard.tsx`
  and passed as controlled `focused`/`onSelectHour` to both UVTimeline and SunArc; the
  fixed-height readout pinned at the TOP of the UV card tracks the same focus. Keep the
  arc markers on the same bezier (`M 34 118 Q 160 12 286 118`) as the drawn curve so x
  maps 1:1 to the hour.
- **[branch `mobile-uv-ab-arc`] Sun-path is gated twice:**
  `process.env.NEXT_PUBLIC_HIDE_SUNPATH !== '1' && prefs.showSunPath !== false`. The env
  flag is the **build-time** arc-off switch (must be in deploy.yml's Build env block to
  take effect in a deployed build); `prefs.showSunPath` is the user-facing settings
  toggle. **A/B DECIDED: the sun-path design wins** — the arc-off build was the losing
  variant; keep the design with the toggle.
- **[branch `mobile-uv-ab-arc`] Settings = full-screen on mobile, modal on desktop.**
  Driven by `.settings-*` classes (one ≤640px media query fills the viewport with
  100dvh + safe-area insets; even L/R padding). Background scroll is locked by
  **`lib/useBodyScrollLock.ts`** (SSR-safe, effect-only, **ref-counted** for nested
  overlays) — used by `PreferencesModal` and `ActivityModalShell`; reuse this hook for
  any new full-screen overlay rather than touching `body.style` directly. The header's
  Settings + Sign out live in a profile-avatar dropdown.
- **Historical note:** The commit-trailer direction recorded for this wave is retired.
  Follow the current repository `AGENTS.md` for commit requirements.
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
| `components/App.tsx` | Screen routing, auth listener, `effectiveView` guest gating. **[branch] mandatory sign-in — no guest path into the dashboard** |
| `components/Onboarding.tsx` | **[branch] rebuilt: ends at a required Google sign-in (no skip), no activity step, no marketing, scroll-locked, thumb-zone CTAs** |
| `components/Dashboard.tsx` | "Best window today" hero, metrics, Activities (PlanAhead nested). **[branch] owns the shared `focusedHour`; UV card = top readout → SunArc → `.uv-strip`; sun-path gated on `NEXT_PUBLIC_HIDE_SUNPATH`+`prefs.showSunPath`; Today/Tomorrow/"More days" picker; "+ Add Activity"/"Manage"** |
| `components/SunArc.tsx` | **[branch] interactive sun path: shared `focusedHour`, tap/drag scrubbing, per-hour UV-color gradient, ~3h ticks + peak on the arc (`.sun-arc-plot`)** |
| `components/UVTimeline.tsx` | **[branch] the scrollable/tappable `.uv-strip` (current hour centered, non-selectable numbers, scroll-sync to the arc); controlled via `focused`/`onSelectHour`** (prior wave: flex-fit hour bars) |
| `components/TipCarousel.tsx` | **[branch] tighter, horizontally-swipeable tips (scroll-snap track + synced dots)** |
| `components/Header.tsx` | Header layout; `.hdr-*` classes wrap location pill to its own row ≤560px. **[branch] Settings + Sign out collapsed into a profile-avatar dropdown** |
| `components/PlanAhead.tsx` | "Best day this week" — nested inside Activities, not standalone |
| `components/Welcome.tsx` | **[branch] marketing stripped (no "No sign-up required" / feature pills; CTA "Get started")** |
| `components/ActivityModalShell.tsx` | Shared full-screen-on-mobile modal shell; **[branch] uses `useBodyScrollLock`; backs the "More days" picker** |
| `components/InstallPrompt.tsx` | PWA install prompt + iOS Safari "Add to Home Screen" hint (push entry point) |
| `components/NotificationBanner.tsx` | The Enable-notifications banner (next step 2) |
| `components/PreferencesModal.tsx` | Settings modal; has the "Enable notifications" button. **[branch] full-screen on mobile / modal on desktop; uses `useBodyScrollLock`** |
| `components/GoogleSignInButton.tsx` | Shared sign-in + `ACTIVITY_SIGNIN_BLURB` |
| `lib/useBodyScrollLock.ts` | **[branch] SSR-safe, ref-counted body-scroll-lock hook (PreferencesModal + ActivityModalShell)** |
| `app/globals.css` | CSS vars + mobile utilities: `.hdr-*`, `.dash-stack`, `.show-mobile`/`.hide-mobile` (≤560px). **[branch] adds `.uv-strip`, `.sun-arc-plot`, `.settings-*`** |
| `lib/tiers.ts` | Tier limits (anonymous=0 activities) + preset catalog |
| `lib/weather.ts` | Display helpers incl. `formatUV` |
| `lib/prefs.ts` | Prefs schema, `solara_prefs` localStorage key, Firestore persistence |
| `functions/` | Blaze-only scaffold: Stripe webhook + live feed (NOT deployed) |
