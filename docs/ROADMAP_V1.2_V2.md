# Solara — V1.2 → V2 Upgrade Plan

_Last updated: 2026-05-30_

> **Status:** V1.2 code complete. **P0** (forecast consolidation), **P2** (weekday/weekend
> routines), **P3** (cloud sensitivity), **P4** (multi-location) are shipped with tests
> (97 passing). **P1** (calendar live) is built + unit-tested but **blocked on provisioning
> the Google OAuth client ID** — an ops step, not code. V2 (P5–P8) not started.

A step-by-step plan to take Solara from "live daily UV planner" to "calendar-native
sun assistant you pay for." Each phase is shippable on its own, ordered so dependencies
resolve before the features that need them.

**Spine = the data model.** Most phases bump `PREFS_SCHEMA_VERSION` and add a normalizer
in `lib/prefs.ts`. Old records must keep loading — `normalizePrefs()` is the contract.
We go from schema **v2 → v6** across this plan.

**Guiding rules**
- Every new safety-relevant calc gets pure unit tests (`lib/*.test.ts`), like `scheduler`/`planner`.
- New Pro surfaces gate through `TIER_LIMITS` in `lib/tiers.ts` — never ad-hoc checks.
- Static export: no server runtime. Anything needing a server is explicitly flagged **(Blaze)**.

---

## Dependency order at a glance

```
P0 Forecast consolidation ─┬─► P3 Cloud sensitivity
                           └─► P4 Multi-location
P1 Calendar live (ops)  ─────► P7 Two-way sync ──► P8 Auto-reschedule
P2 Weekday/weekend routines
P5 Stripe webhook (Blaze)  ── unlocks real Pro fulfilment for everything below
P6 Family & pet profiles ────► (re-runs scheduling per profile)
```

Recommended ship sequence: **P0 → P1 → P2 → P3 → P4** (completes V1.2), then
**P5 → P6 → P7 → P8** (V2).

---

# V1.2 — Smarter planning

## P0 — Consolidate the forecast pipeline _(prerequisite, no user-facing change)_

**Why first:** `components/App.tsx` fetches Open-Meteo with `forecast_days=10`
(`hourly=uv_index,temperature_2m,weathercode`) and `components/CalendarView.tsx` fetches
*again* with `forecast_days=${dayLimit}` and a different hourly set. Cloud sensitivity (P3)
and multi-location (P4) both need a single fetch keyed by location, or we duplicate the
mess N×.

**Steps**
1. New `lib/forecast.ts`: `fetchForecast(location, { days, signal })` → `WeatherResponse`.
   Single Open-Meteo URL builder; `hourly=uv_index,temperature_2m,weathercode,cloudcover`
   (add `cloudcover` now so P3 is free).
2. In-memory + `localStorage` cache keyed by `lat,lon,days,schemaVersion`, ~30-min TTL.
3. Refactor `App.tsx` and `CalendarView.tsx` to consume `fetchForecast`. Delete the duplicate URLs.
4. Add `cloudCover?: number` to `HourlyForecast` in `lib/types.ts` (optional → back-compat).

**Tests:** `lib/forecast.test.ts` — URL building, response parse (mock fetch), cache hit/miss/expiry.

**Risk:** low. Pure refactor; verify Dashboard + Calendar still render identical windows.

---

## P1 — Turn the calendar scheduler on, live _(mostly ops — code is built)_

The engine (`lib/scheduler.ts`), planner (`lib/planner.ts`), and Google client (`lib/gcal.ts`)
already exist and are unit-tested. What's missing is a real OAuth client + live verification.

**Steps**
1. **(Your step)** Google Cloud project → enable Calendar API → OAuth consent screen →
   Web OAuth client ID with the deploy domain as authorized JS origin.
2. Set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (secret already wired into `deploy.yml`).
3. Live-verify the round trip on the deployed site: `connectCalendar()` → `fetchFreeBusy`
   → "Recommended" slot reflects real busy blocks → "Book this time" writes an event with the
   flexible-range description.
4. Confirm the freeBusy privacy story holds (only busy times returned, never event titles).
5. Add a tiny `calendar_connected` analytics event (ties into the V1 analytics item).

**Tests:** already covered (`gcal.test.ts`, `scheduler.test.ts`). Add a Playwright smoke that
mocks the token + freeBusy response end-to-end.

**Risk:** OAuth origin/redirect misconfig is the usual snag — verify on the real domain, not localhost.

---

## P2 — Weekday vs. weekend routines

**Goal:** "Run on weekdays 6–7am, garden on weekends." Activities become day-aware so
recommendations and notifications only fire on relevant days.

**Data model (schema v3)**
```ts
// Activity gains:
daysOfWeek?: number[]   // 0=Sun … 6=Sat; undefined = every day
```
- `normalizeActivity` in `lib/prefs.ts`: accept an array of 0–6 ints, else `undefined`.

**Steps**
1. Add the field + normalizer + migration bump.
2. `EditActivityModal`: a 7-chip M T W T F S S toggle (default all selected = `undefined`).
3. `lib/planner.ts` `bestUpcomingSlot`: skip a `day` when `activity.daysOfWeek` is set and
   doesn't include that date's weekday. (`day.dateStr` → `new Date(dateStr).getDay()`.)
4. Same filter in `scripts/notify` so morning nudges respect routines.
5. `ActivityCards`/`PlanAhead`: show a small "Weekdays"/"Weekends"/"Mon, Wed" chip.

**Tests:** `planner.test.ts` — an activity restricted to weekends is skipped on weekdays and
chosen on Saturday.

**Risk:** low. Timezone: derive weekday from the local `dateStr`, not UTC `Date`.

---

## P3 — Cloud-cover & shade sensitivity

**Goal:** UV is materially lower under cloud. Let exposure-sensitive activities (or all,
optionally) treat heavily-clouded hours as safer, and surface why.

**Data model (schema v4)**
```ts
// Activity gains:
cloudSensitive?: boolean   // when true, effective UV is discounted by cloud cover
```
Uses the `cloudCover` already added to `HourlyForecast` in P0.

**Steps**
1. New pure helper `lib/exposure.ts`: `cloudAdjustedUV(uv, cloudCover)` — e.g. attenuate up
   to ~30% at 100% cloud (conservative; never *raise* UV). Keep the curve in one place + tested.
2. `getActivityWindow` (`lib/weather.ts`): when `activity.cloudSensitive`, compute
   `safeNow`/windows against `cloudAdjustedUV(h.uv, h.cloudCover)`. Default off → no behavior change.
3. UI: in `ActivityCards`, when a window only qualifies *because* of cloud, label it
   "Safe under cloud" so the user knows it's weather-dependent.
4. `EditActivityModal`: a "Account for cloud cover" toggle with a one-line explainer.

**Tests:** `exposure.test.ts` — monotonic, clamped, never increases UV; `weather.test.ts` —
a cloudy hour that's unsafe at raw UV becomes safe when `cloudSensitive`.

**Risk:** medium — this changes safety output. Be conservative (under-promise safety), and keep
the disclaimer prominent. Never let cloud adjustment turn a UV 11 hour "safe."

---

## P4 — Multi-location

**Goal:** "Where I am" + "where I'll be Saturday." Save several locations, switch the active
one, and (Pro) plan against a different location per day/trip.

**Data model (schema v5)**
```ts
// UserPreferences gains:
savedLocations?: Location[]   // `location` remains the ACTIVE location (back-compat)
```
- `normalizePrefs`: dedupe by `lat,lon` rounded; cap length (e.g. 5 free / unlimited Pro).
- `TIER_LIMITS`: add `savedLocations: number` (e.g. `free: 1`, `paid: 5+`).

**Steps**
1. Add field + normalizer + migration. `location` stays as the active pointer.
2. `LocationPopover`: list saved locations, "＋ Add", switch active, remove. Gate count by tier.
3. `App.tsx`: `fetchForecast` per active location (P0 cache already keys on `lat,lon`, so
   switching is instant if cached).
4. (Pro) optional per-day location override in the Plan-Ahead view — schedule a trip day
   against its destination forecast.

**Tests:** `prefs.test.ts` — dedupe, cap, active-location back-compat from a v2 record.

**Risk:** low–medium. Watch the gcal timezone assumption (`lib/gcal.ts` assumes device TZ ==
location TZ) — for a *different* location, surface the TZ caveat or carry an Olson TZ on `Location`.

> **V1.2 ships here.** Calendar-native, routine-aware, cloud-aware, multi-location.

---

# V2 — Reason to pay

## P5 — Stripe webhook + real Pro fulfilment **(Blaze)**

**Goal:** Paying flips you to `paid` automatically. Today `lib/billing.ts` attaches the Firebase
uid as `client_reference_id` on the Payment Link, but nothing consumes it — fulfilment is manual.

**Why here:** everything below is a Pro feature. Automatic fulfilment should exist before you lean
on the paywall. This is the one phase that requires **Blaze** (Cloud Functions).

**Steps**
1. **(Your step)** Attach billing → upgrade project to **Blaze**; set a budget alert (~$5/mo).
2. `functions/` (new): a single `stripeWebhook` Cloud Function. On `checkout.session.completed`,
   verify the Stripe signature, read `client_reference_id` → `users/{uid}.tier = 'paid'`.
3. Register the webhook URL in Stripe; store the signing secret in function config (not client).
4. Add a `users/{uid}` Firestore rule note: tier is server-written only — clients may read, not set `tier`.
5. Test in Stripe **test mode** end-to-end; confirm a real test purchase flips the tier live.

**Tests:** function unit test for signature verification + the completed-session → tier write
(mock Firestore Admin). Keep the handler tiny and pure where possible.

**Risk:** medium. Webhook signature handling and idempotency (Stripe retries) are the gotchas —
make the tier write idempotent.

---

## P6 — Family & pet profiles

**Goal:** Different people burn differently. "Is it safe for the kids at noon?" / "walk the dog."
Each profile carries its own skin type; scheduling can run per profile.

**Data model (schema v6)**
```ts
export interface Profile {
  id: string
  name: string            // "Me", "Ava (6)", "Rex 🐕"
  skinType: SkinType
  icon?: string
}
// UserPreferences gains:
profiles?: Profile[]       // first profile mirrors top-level skinType (back-compat)
activeProfileId?: string
```
- Migration: synthesize a default profile `{ id:'me', name:'Me', skinType }` from the existing
  top-level `skinType` so v2–v5 records load unchanged.
- `TIER_LIMITS`: `profiles` (e.g. `free: 1`, `paid: 6`).

**Steps**
1. Add types + normalizer + migration. Keep `skinType` as the active profile's value (back-compat
   for every existing `getActivityWindow(..., skinType)` call site).
2. Profile switcher in the header; per-profile skin type in Preferences.
3. **Per-profile scheduling:** `getActivityWindow` already takes `skinType` — call it per active
   profile. A "compare profiles" view: show the safe window for each family member side by side
   (the kid's window is narrower than yours — that's the visceral value).
4. Pet preset: a "dog walk" activity with a low default `maxUV` and a midday-avoidance hint.

**Tests:** `prefs.test.ts` — v2 record (no profiles) yields a single "Me" profile with the right
skin type; window math differs across two profiles on the same forecast.

**Risk:** medium — it touches the most call sites. The back-compat trick (active profile mirrors
`skinType`) keeps the blast radius small; do that first, then add the switcher.

---

## P7 — Calendar two-way sync / ICS feed

**Goal:** Solara's recommendations live *in* your calendar, and stay there. Two deliverables of
increasing power:

**7a. Client-side ICS export (no server, stays on Spark).**
- New `lib/ics.ts`: pure `buildICS(events)` → a downloadable `.ics` for the week's recommended
  slots (reuses `buildEventDescription` from `lib/gcal.ts`). "Add my sun plan to any calendar" button.
- Tests: `ics.test.ts` — valid VEVENT, correct local times, escaping.

**7b. Live subscribable feed **(Blaze)**.**
- A `calendarFeed` Cloud Function serving a per-user `webcal://…/feed/{token}.ics` that regenerates
  from the latest forecast + prefs. This is the true "set and forget" sync — the calendar updates
  as the forecast changes.
- Store a per-user feed token in `users/{uid}`; rotate/revoke from settings.

**Track what we wrote:** persist created events so we own them (needed for P8):
```ts
// users/{uid}/scheduledEvents/{id}
{ activityId, dateStr, start, end, gcalEventId, createdAt }
```

**Risk:** 7a low. 7b medium (auth on an unauthenticated feed URL → use an unguessable token; treat
it like a secret).

---

## P8 — Auto-rescheduling

**Goal:** The standout V2 feature. "Your 5pm run now overlaps a meeting / UV spiked — moved to
6:15pm, still safe." Solara defends your sun time.

**Depends on:** P1 (live calendar write), P7's `scheduledEvents` tracking (so we know which events
are ours to move).

**Steps**
1. On forecast refresh / calendar reconnect, for each tracked `scheduledEvent`: recompute
   `recommendSlot` for that day with the *current* busy + forecast.
2. Detect drift: the event now collides with a new busy block, or its slot's UV exceeds the
   activity threshold (the forecast changed).
3. Offer a one-tap "Move to {new time}" → `events.patch` via the write token; update the tracked record.
4. (Pro) opt-in **auto**-move without asking, with a daily summary notification of what changed.
5. Server-side variant **(Blaze):** a daily function that re-checks tracked events and pushes an
   FCM "we moved your run" — true background defense. Reuses the `notify.yml`/FCM path.

**Tests:** `reschedule.test.ts` (pure) — given an old slot + new busy/forecast, returns
{ unchanged | move(newSlot) | drop(no safe slot today) }. This is the high-value pure core; test it hard.

**Risk:** medium–high (it mutates the user's real calendar). Always confirm before moving by
default; make auto-move strictly opt-in; never silently delete.

---

## Cross-cutting, do alongside

- **Schema migration tests:** one `prefs.test.ts` case per version bump (v2 → v6) proving an old
  record loads. This is the safety net for the whole plan.
- **Analytics:** add an event per new surface (`calendar_connected`, `profile_added`,
  `location_added`, `reschedule_accepted`, `ics_exported`) — you'll want the funnel before pricing.
- **`TIER_LIMITS` is the paywall:** every Pro gate (multi-location count, profile count, auto-move,
  feed) flows through `lib/tiers.ts`. Keep it the single source of truth.
- **Disclaimer stays visible** anywhere cloud/skin adjustments change a safety verdict (P3, P6).

---

## Milestones

| Milestone | Phases | Plan | Headline |
|---|---|---|---|
| **V1.2** | P0–P4 | Spark | Calendar-native, routine + cloud aware, multi-location |
| **V2.0** | P5–P6 | Blaze | Real paywall + family/pet profiles |
| **V2.1** | P7–P8 | Blaze | Two-way calendar sync + auto-rescheduling — "Reclaim.ai for sunlight" |
</content>
</invoke>
