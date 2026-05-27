# Solara Follow-Up Roadmap

_Last updated: 2026-05-27_

## Purpose

This document captures the gaps found during the current Solara repo review and turns them into a sequenced follow-up plan. It is intentionally broader than a bug list: it includes immediate code issues, product gaps, V1 readiness, and future-version modeling so the repo can move from “solid prototype” to “safe public daily-use tool.”

## Current product read

Solara is currently a personalized UV and outdoor-activity planner. The repo already has a meaningful core loop:

- User enters or detects a location.
- App fetches UV and weather forecast data from Open-Meteo.
- User chooses skin type and outdoor activities.
- Dashboard shows current UV, burn time, vitamin D timing, and safe activity windows.
- Calendar view visualizes future safe windows.
- Firebase Auth/Firestore exists for account sync.
- FCM notification infrastructure exists in code and GitHub Actions.

That is enough to feel like a real product, not just a mockup. The main issue is that the app has jumped ahead into “daily tool / freemium / notifications” territory before the safety, privacy, installability, and conversion foundations are fully locked down.

## V1 readiness assessment

### Where the repo is strong

- The core UV/weather dashboard is already implemented.
- The activity model is useful and extensible.
- The calendar view makes the product feel differentiated.
- Anonymous-first usage is the right onboarding move.
- Google sign-in and Firestore sync are already integrated.
- Push notification client/server pieces exist, which is more than most early V1s.

### Where it falls short for public V1

For a private demo or personal-use prototype, the repo is close. For a public V1, it is not quite ready because the “trust layer” is incomplete.

The biggest blockers are:

1. Firestore access must be locked down before any public sharing.
2. Dev-only controls must not ship to production.
3. Old saved preferences need migration/validation before the app relies on the current `Activity` shape.
4. PWA installability, icons, and metadata are missing or incomplete.
5. The notification system needs an actual end-to-end test, not just infrastructure.
6. The app needs analytics before making pricing/conversion decisions.

### Previous-scope comparison

I did not find a clean, authoritative V1 PRD inside this repo. The README describes the intended Solara scope as a personalized UV/sun exposure dashboard with Open-Meteo data, activity windows, no-sunscreen mode, today/tomorrow forecast, Google Calendar integration, anonymous use, Google sign-in sync, and adjustable activity durations.

Against that README-level V1, the product is mostly feature-complete, but not release-complete. The missing pieces are not “more features”; they are release hygiene, safety, privacy, onboarding polish, and product feedback loops.

In other words: the first version should probably not expand much. It should harden.

## Priority map

### P0 — must fix before public sharing

#### 1. Add Firestore security rules

**Problem:** The app uses Firestore for user preferences, location, activities, FCM token, and notification state, but there is no `firestore.rules` file and `firebase.json` does not deploy Firestore rules.

**Risk:** If Firestore is left permissive in the Firebase console, anyone who discovers the project ID could read or write user data.

**Fix:**

- Add `firestore.rules`.
- Allow each signed-in user to read/write only `users/{uid}` where `request.auth.uid == uid`.
- Deny public reads/writes by default.
- Update `firebase.json` to deploy rules.
- Confirm the production Firebase console is not in test mode.

**Acceptance criteria:**

- Signed-out users cannot read/write any Firestore user document.
- User A cannot read/write User B’s document.
- User A can read/write only `users/{userA.uid}`.
- Deploy workflow publishes rules or rules are deployed manually with a documented command.

#### 2. Hide DevPanel outside development

**Problem:** `components/App.tsx` always renders `<DevPanel />`; `components/DevPanel.tsx` does not gate itself on `process.env.NODE_ENV`.

**Risk:** Production users could see or trigger tier-preview controls.

**Fix:**

- Gate rendering in `App.tsx`, or return `null` inside `DevPanel` unless `process.env.NODE_ENV === 'development'`.
- Clear or ignore `solara_dev_tier` outside development.

**Acceptance criteria:**

- Dev panel appears in `npm run dev`.
- Dev panel does not appear in production builds.
- Production behavior cannot be overridden by stale `localStorage.solara_dev_tier`.

#### 3. Add preference migration and schema validation

**Problem:** `Activity` now requires `sunscreen`, but old localStorage/Firestore records may not have it. `loadLocalPrefs()` returns parsed JSON directly, and `loadFirestorePrefs()` casts Firestore data directly to `UserPreferences`.

**Risk:** Returning users can silently get broken activity behavior, bad safe-window calculations, or inconsistent UI.

**Fix:**

- Add a `PREFS_SCHEMA_VERSION`.
- Normalize loaded preferences through a migration function.
- Ensure each activity has `sunscreen`, `durationMins`, `maxUV`, `icon`, and stable ID.
- Backfill `calendarHours` defaults.
- Ignore invalid activities rather than crashing.

**Acceptance criteria:**

- Old preferences without `activity.sunscreen` load safely.
- Invalid localStorage data is cleared or repaired.
- Firestore preferences are normalized before use.
- Migration is covered by at least a few unit tests or a manual test matrix.

#### 4. Fix sunscreen/effective UV consistency

**Problem:** The code has multiple places where sunscreen-aware logic is inconsistent.

Examples:

- `effectiveMaxUV(activity)` exists, but `getActivityWindow()` calculates `safeNow` using `activity.maxUV`, not the effective value.
- `getActivityWindow()` calculates burn time using hard-coded `'fair'` instead of the user’s selected skin type.
- Calendar and notification copy can reference `activity.maxUV` even when sunscreen changes the effective threshold.
- Notification script uses `act.maxUV` directly.

**Risk:** The app can tell users a window is safe or unsafe inconsistently across dashboard, calendar, and notifications. For a UV/sun tool, that is a trust issue.

**Fix:**

- Centralize exposure calculation in one shared module.
- Pass `skinType` into activity-window calculations.
- Use `effectiveMaxUV()` everywhere activity safety is computed or described.
- Decide whether sunscreen is global, per-activity, or both; right now the model says both, but the UI is muddy.

**Acceptance criteria:**

- Dashboard, calendar, Add to Calendar, and notifications agree for the same activity/day.
- Safe Now uses the same threshold as Best Window.
- Burn time reflects selected skin type.
- Copy clearly says whether a recommendation assumes sunscreen or no sunscreen.

#### 5. Confirm notification end-to-end path

**Problem:** The code has FCM client registration, a generated service worker, a GitHub Actions cron, and a send script. It is not clear that the full path has been tested in production.

**Risk:** Notifications are a major Pro/value feature, but they may fail silently due to service worker scope, VAPID key, Firestore rules, missing token, invalid icon paths, timezone assumptions, or GitHub secret formatting.

**Fix:**

- Add a documented manual test plan.
- Run workflow dispatch against a real test user.
- Confirm browser foreground and background behavior.
- Confirm FCM token is saved to Firestore after login.
- Confirm cron timing in UTC and daylight-saving behavior.
- Consider moving `firebase-admin` into dependencies or documenting why the workflow installs it ad hoc.

**Acceptance criteria:**

- A test user receives a real notification from workflow dispatch.
- Token save, Firestore query, weather fetch, FCM send, and click-through all work.
- Failures are visible in GitHub Action logs.
- Notifications are not marketed until this passes.

## P1 — code quality and platform cleanup

#### 6. Remove committed `tsconfig.tsbuildinfo`

**Problem:** `tsconfig.tsbuildinfo` is committed, and `.gitignore` does not include it.

**Fix:**

- Add `*.tsbuildinfo` to `.gitignore`.
- Delete `tsconfig.tsbuildinfo` from the repo.

#### 7. Remove orphaned `DEFAULT_ACTIVITIES`

**Problem:** `lib/weather.ts` still exports `DEFAULT_ACTIVITIES`, but the app now uses `ACTIVITY_CATEGORIES` / `PRESET_ACTIVITIES` from `lib/tiers.ts`.

**Fix:**

- Delete `DEFAULT_ACTIVITIES` if unused.
- Keep one source of truth for preset activities.

#### 8. Consolidate Open-Meteo fetching and caching

**Problem:** Dashboard weather is fetched in `components/App.tsx` with `forecast_days=10`; `CalendarView` separately fetches Open-Meteo with `forecast_days=7`.

**Risk:** Duplicate API usage, inconsistent forecasts, extra loading states, and drift between dashboard and calendar.

**Fix:**

- Create a shared `lib/weatherClient.ts` or `lib/forecast.ts`.
- Fetch once per location/time bucket.
- Let Dashboard and Calendar consume the same normalized forecast object.
- Cache by location + forecast type + schema version.

**Acceptance criteria:**

- Dashboard and Calendar do not each independently call Open-Meteo for the same location.
- Refresh invalidates one shared cache.
- Calendar can render from the same forecast object as Dashboard.

#### 9. Align Next.js package versions

**Problem:** `package.json` uses `next ^16.2.6` with `eslint-config-next 14.2.3`.

**Risk:** Version mismatch can create lint/config weirdness and future upgrade pain.

**Fix:**

- Align `eslint-config-next` with the installed Next version, or pin Next to the intended version.
- Confirm static export works with the chosen Next version.

#### 10. Add basic quality gates

**Problem:** There is no obvious test script, typecheck script, or build-verification checklist beyond `npm run build`.

**Fix:**

- Add `typecheck`, `lint`, and `build` commands that work in CI.
- Consider a tiny test suite for preference migration and safe-window calculations.

## P1 — UX and trust polish

#### 11. Warn before closing preferences with unsaved changes

**Problem:** Preferences can be changed, then lost by clicking the backdrop, close button, or Cancel.

**Fix:**

- Track dirty state.
- Confirm before closing if unsaved changes exist.
- Consider changing “Cancel” to “Discard” when dirty.

#### 12. Pause tip carousel on hover/focus

**Problem:** `TipCarousel` rotates every six seconds regardless of whether the user is reading.

**Fix:**

- Pause interval on hover, focus, and reduced-motion preference.
- Resume when the user leaves.

#### 13. Simplify mobile header

**Problem:** Location, tier badge, UV alert, settings, and auth controls all compete in one row.

**Fix:**

- Collapse secondary information on small screens.
- Consider moving tier/auth into preferences/account.
- Truncate location more aggressively.
- Show UV alert as compact icon/pill.

#### 14. Add Add-to-Calendar confirmation

**Problem:** Add-to-Calendar opens a new tab but does not confirm success or explain what happened.

**Fix:**

- Show a small “Opened Google Calendar” toast.
- Add fallback copy if pop-up blocked.
- Consider “Copy calendar link” as secondary action.

#### 15. Make crowded calendar usable with 4+ activities

**Problem:** Calendar activity blocks divide width by activity count, which becomes unreadable quickly.

**Fix options:**

- Activity filter/toggle: show one activity or selected activities.
- Horizontal scroll inside each day.
- Max column width with stacked/overlap indicators.
- Compact mode that shows availability count first, details on tap.

## P1 — product and growth gaps

#### 16. Make “Upgrade to Pro” do something

**Problem:** The Upgrade button currently has no action.

**Fix options:**

- Start with a waitlist/email capture.
- Or open a lightweight pricing modal that says Pro is coming soon.
- Or route to Stripe when paid plans are real.

**Recommended V1 move:** Waitlist capture. Do not wire Stripe until the value metric is clearer.

#### 17. Add Firebase Analytics or PostHog

**Problem:** There is no analytics layer, so product decisions are blind.

**Events to track first:**

- `onboarding_started`
- `location_set`
- `activity_added`
- `calendar_view_opened`
- `calendar_add_clicked`
- `notification_prompt_shown`
- `notification_enabled`
- `upgrade_clicked`
- `share_clicked`

#### 18. Reconsider free tier limit

**Problem:** Free tier allows 1 activity. That may be too tight to create habit or show value.

**Recommendation:** Move Free to 3 activities. Keep Pro for unlimited activities, 10-day forecast, notifications, calendar enhancements, saved routines, and smarter planning.

#### 19. Add share functionality

**Problem:** Solara has naturally shareable content but no share loop.

**Good V1 share target:**

- “Here’s my best UV window today.”
- “Best time for a run in Los Angeles: 7–9am.”
- “Peak UV today is 9.1 — I’m going outside before 10.”

Use Web Share API where available, fallback to copy link/text.

## P2 — future-version modeling

### V1.0 — harden the daily utility

Goal: trustworthy, installable, shareable daily UV planner.

Must include:

- Firestore rules.
- Dev-only gates.
- Preference migration.
- One weather/cache pipeline.
- PWA manifest/icons.
- OG/social metadata.
- Basic analytics.
- Upgrade/waitlist capture.
- Manual notification test pass.
- Mobile header cleanup.

Do not add big new surface area until this is done.

### V1.1 — habit loop and install loop

Goal: make people check it daily.

Potential features:

- “Today’s best window” home-screen shortcut feel.
- PWA install prompt.
- Share card/image/text.
- Morning notification preference.
- Saved routine presets: run, dog walk, garden, lunch, swim.
- Better empty states and onboarding examples.

### V1.2 — smarter planning

Goal: make Solara feel personalized beyond raw UV data.

Potential features:

- Preferred outdoor hours.
- Workday/weekend routine differences.
- Shade/cloud sensitivity.
- Activity intensity and exposure level.
- “Best day this week for X” recommendations.
- Calendar export that schedules the actual session length inside the safe window, not the whole safe window.

### V2 — Pro-worthy assistant

Goal: create a reason to pay.

Potential Pro features:

- Unlimited activities.
- 10-day forecast.
- Push notifications.
- Saved routines.
- Multi-location support.
- Smart weekly planner.
- Calendar sync/ICS feed.
- Advanced skin/exposure settings.
- Family profiles or pet/outdoor-care profiles.

### V3 — confidence, safety, and modeling layer

Goal: make the recommendations more credible and less generic.

Potential work:

- Add confidence bands around UV/weather data.
- Add source notes and “estimate only” disclaimers.
- Model cloud cover, season, altitude, shade, and reflected exposure.
- Compare multiple weather/UV sources if needed.
- Let users give feedback: “I burned,” “too conservative,” “worked well.”
- Use feedback to tune thresholds over time.

## Immediate implementation sequence

### PR 1 — Security hardening

- Add `firestore.rules`.
- Update `firebase.json` to deploy rules.
- Verify Firebase console mode.
- Add short `docs/SECURITY_CHECKLIST.md` or section in README.

### PR 2 — Release hygiene cleanup

- Gate `DevPanel`.
- Add `*.tsbuildinfo` to `.gitignore`.
- Delete `tsconfig.tsbuildinfo`.
- Remove orphaned `DEFAULT_ACTIVITIES`.
- Align Next/eslint-config versions.

### PR 3 — Preferences and exposure correctness

- Add migration/normalization for localStorage and Firestore prefs.
- Centralize exposure/safe-window calculations.
- Fix sunscreen and skin-type consistency.
- Add minimal tests for old prefs + safe-window logic.

### PR 4 — Forecast service consolidation

- Move Open-Meteo fetch/parse/cache into one shared module.
- Have Dashboard and Calendar consume one forecast shape.
- Add cache schema versioning.

### PR 5 — PWA and metadata

- Add `public/manifest.json`.
- Add icons: 72, 192, 512, maskable if possible.
- Add full metadata: Open Graph, Twitter card, theme color.
- Confirm Firebase static export serves the assets.

### PR 6 — UX polish

- Dirty-state warning for Preferences.
- Tip carousel pause on hover/focus/reduced-motion.
- Mobile header simplification.
- Add-to-calendar toast/fallback.
- Calendar activity filter/toggle.

### PR 7 — Product instrumentation

- Add Firebase Analytics or PostHog.
- Track the first event set.
- Wire Upgrade to Pro to waitlist capture.
- Consider changing Free from 1 activity to 3.

### PR 8 — Notification validation

- Document manual test path.
- Run workflow dispatch with a test user.
- Fix any FCM/service-worker/icon/rules issues.
- Only then treat notifications as a real Pro feature.

## Nice-to-have backlog

- Add privacy copy explaining what is stored locally vs Firestore.
- Add “Delete my data” account action.
- Add app version/build hash somewhere hidden for debugging.
- Improve weather error states with retry and cached fallback.
- Add loading skeleton for CalendarView.
- Add reduced-motion support for other UI transitions.
- Add accessibility pass for buttons, focus states, and color contrast.
- Add legal/safety disclaimer for burn/vitamin D estimates.
- Add README screenshots once UI stabilizes.

## Product stance

The right next move is not to make Solara bigger. It is to make Solara trustworthy.

The app already has enough feature gravity for V1: dashboard, activity windows, calendar, auth sync, notifications-in-progress. The highest-leverage work now is to remove anything that could embarrass or endanger the launch: open Firestore, production dev panel, stale preference data, inconsistent sunscreen math, missing install metadata, and untested notifications.

Once that is clean, Solara can move into growth loops: PWA install, morning notifications, share cards, analytics, and a simple Pro waitlist.
