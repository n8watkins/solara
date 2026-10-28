# Solara handoff

## Current state and open work (2026-10-27): start here

This section is the entry point for an agent starting in this repository with no other context.
It points to the detailed docs instead of repeating them.

### What Solara is and where it lives

Solara is a personalized UV and outdoor-activity planner (Next.js on Firebase Hosting, Firestore, Firebase Functions).
It is live at https://solara-uv.web.app; the old https://uv-activity-planner.web.app redirects there.
The Firebase project is `uv-activity-planner`, on the free Spark plan until the Pro launch.
Every merge to `main` deploys automatically.

The detailed docs are the source of truth:

- [status.md](status.md): what is live, what is built but switched off, CI/CD, owner actions done or open.
- [ROADMAP.md](ROADMAP.md): the plan, decisions, Wave 5 features and Wave 6 (mobile).
- [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md): every step only the owner can do (Pro launch is steps 12-18).
- [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md): how parallel lanes run, the agent contract and the checks to run before pushing.
- [RUNBOOK.md](RUNBOOK.md), [DEPLOYMENT.md](DEPLOYMENT.md), [COSTS.md](COSTS.md).

The coordinating session also keeps lane notes outside the repository, in `/home/natkins/projects/solara/handoff/` (its HANDOFF.md, lane rules, stacked-PR merge script and per-lane notes).
Read that folder's `HANDOFF.md` before launching lanes; it holds the live merge queue.

### Status today

- Free tier is live and healthy; guest mode, Google sign-in, calendar sync and the offline app shell are deployed.
- Pro is built and switched off: billing (Stripe), the account lifecycle, the forecast proxy, the cost guard and budget kill switch, and the Pro morning and UV alerts all wait behind flags (`BILLING_ENABLED`, `FORECAST_PROXY_ENABLED`, `ALERTS_ENABLED`, `ENABLE_BLAZE_FUNCTIONS`) and the owner's Pro launch steps.
- Many Wave 5 features merged on 2026-10-27 (skin quiz, family most-sensitive mode, shade and reflection, daily briefing, cloud-aware forecasts, 50 city pages, sunscreen reapply timer).
- The third security review (13 findings, none critical) is being fixed: #118 and #119 are merged; #120, #121, #122, #123, #124 and the .ics import #117 are open PRs in a merge queue owned by the coordinating session.
  Don't merge or rebase them from another session without checking that session's handoff first.
- No Dependabot PRs or Dependabot alerts are open as of today (the last one, #96, merged on 2026-10-27).
- No release tagging: `package.json` stays at `0.1.0` and the site ships by deploy, not by release.
  Solara is not on release-kit (`github:n8watkins/release-kit`, the owner's release tool used by most of their repos).
- The local clone's checked-out branch `feat/full-hardening` is stale but not stranded: it was squash-merged as #13 on 2026-07-15 and its tree is identical to that merge commit.
  It can be deleted locally and on GitHub as part of [owner checklist](OWNER_CHECKLIST.md) step 11 (branch and worktree cleanup); always work in a fresh worktree from `origin/main`.

### Open problems

1. **Functionality, UX and release readiness need one end-to-end audit.**
   The backlog item is: audit and finish functionality, polish the UX, and prepare a Google Play release.
   Much was built in parallel lanes this week, so walk the real app (guest and signed in, 390 px and 1280 px, light and dark) after the merge queue lands, and list what is unfinished.
   This matches step 2 of the coordinating session's next steps (REVIEW4 plus a FIX4 lane).
2. **Guest first-load JavaScript has a tight budget.**
   `tests/e2e/guest.spec.ts` holds a guest's first load under 193 KB gzip and main is about 189 KB (#126 won back about 10 KB), so new dashboard code that a new guest does not see should load on demand (`components/deferred.tsx`).
   Reproduce with the guest e2e suite after `npm run build`.
3. **Google Play release path is not started.**
   [ROADMAP.md](ROADMAP.md) item 13 (Wave 6) plans an Expo app reusing `packages/core`, Android first, with a Google Play internal test track.
   It needs the owner's Google Play developer account ($25 once).
4. **Marketing copy mismatch on n8builds.dev (not in this repo).**
   The Lab section on n8builds.dev says "no sign-up", while Solara has a Pro plan; the audit suggests "free to start".
   That copy lives in the n8builds.dev repository, so fix it there, not here.
5. **TypeScript 7 is blocked upstream** ([ROADMAP.md](ROADMAP.md) item 8), and three ESLint plugin peer overrides should be removed once those plugins support ESLint 10 (item 7).

### Blocked on the owner

Details and console links are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

- Now, free: Google OAuth client ID and Calendar API (turns on Scheduled), OAuth branding and scope verification, reCAPTCHA v3 key (App Check), Sentry DSN, keyless deploys (Workload Identity Federation), moving public build values to variables, deleting the unused `NEXT_PUBLIC_PRO_PRICE` secret, counsel review of the governing-law text.
- At Pro launch: Blaze with the budget kill switch, staging project and Stripe test mode, Functions secrets, the Open-Meteo commercial plan, then switching the flags on.
- Google Play release: a Google Play developer account ($25 once); iOS later needs an Apple Developer account ($99 per year).
- Confirm or change the defaults the coordinating session took (budget $25 a month, forecast call caps, trial-history retention, quiet hours); they are listed in [ROADMAP.md](ROADMAP.md) under Decisions.

### Next steps, in order

1. Let the coordinating session finish the merge queue (#120, #121, #122, #123, #124, #117); confirm `main` is green and deployed.
2. Run the end-to-end audit of functionality and UX (REVIEW4), then fix what it finds in a FIX4 lane.
3. Done in #126: guest first-load headroom won back (about 189 KB, budget 193 KB).
4. Prepare the Google Play release: decide with the owner between the planned Expo app (Wave 6) and a smaller first step, then set up the Play listing, privacy and data-safety answers, and an internal test track once the owner has the Play account.
5. Adopt release-kit (`github:n8watkins/release-kit`) so versions, changelog and tags are cut the same way as the owner's other repos; this matters once there is a mobile build to version.
   Not adopted yet by decision; do it as its own change.
6. Ask for the "free to start" copy change on n8builds.dev's Lab entry.
7. The Pro launch itself follows the owner's steps 12-18.
