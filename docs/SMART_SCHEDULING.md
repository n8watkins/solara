# Solara — Smart Calendar Scheduling (Design Outline)

_Last updated: 2026-05-29 · Status: design / not yet built_

## The idea in one line

Instead of manually dropping an activity into Google Calendar, **Solara reads your real
availability, intersects it with safe-and-sunny UV windows, and books the best time for you** —
then writes an event that explains *why* that time, and how much flexibility you have.

## Today vs. target

| | Today | Target |
|---|---|---|
| Calendar | One-way: a "Add to Calendar" template link the user fills in | Two-way: Solara reads free/busy and creates the event |
| Time choice | User eyeballs a safe window and picks | Solara recommends the best feasible slot automatically |
| Constraints | UV threshold + per-activity preferred hours (already exist) | + real calendar availability + a time-of-day preference |
| Event body | Generic ("safe UV window") | Explains the pick + the flexible range |

## The worked example (the user's scenario)

> "My run has to be in the afternoon. I won't wear sunscreen, so high-UV midday is out. My
> afternoon is busy until 5. So book it for **5:00pm — the earliest I'm free in a safe afternoon
> window** — and note that I could go anywhere **5:00–7:00pm** and still catch sun."

Everything in that sentence maps to a constraint the engine already has, or one we're adding:

| Phrase | Constraint | Source |
|---|---|---|
| "has to be in the afternoon" | `preferredHours` | **exists** (`Activity.preferredHours`) |
| "won't wear sunscreen" | lowers the safe UV threshold | **exists** (`effectiveMaxUV(activity)`) |
| "busy until 5" | calendar free/busy | **new** (Google Calendar read) |
| "earliest I'm free" | time preference = `earliest` | **new** (scheduling objective) |
| "could go 5–7 and still get sun" | the flexible feasible range | **new** (engine output) |

---

## Constraint model — what the user sets up

Three layers, intersected in order. Two of the three already exist in the codebase.

1. **Safe-and-sunny (UV)** — _exists._ A window is safe when `uv <= effectiveMaxUV(activity)`.
   Turning sunscreen off lowers the threshold and naturally shrinks availability. "Enjoy the
   sun" means we don't just want *safe* — we want time that is sunny **and** under the limit.
2. **Preferred hours (intent)** — _exists._ `Activity.preferredHours = { from, to }` — "when
   would I ever want to do this" (e.g. afternoon only).
3. **Real availability (calendar)** — _new._ Busy intervals pulled from Google Calendar
   free/busy, subtracted from the feasible set.

New per-activity (or global default) field:

```ts
// lib/types.ts
type TimePreference = 'earliest' | 'latest' | 'sunniest'

interface Activity {
  // ...existing...
  timePreference?: TimePreference   // default 'earliest'
}
```

- `earliest` — soonest free safe slot (the 5pm example). **Default.**
- `latest` — latest safe slot before UV/forecast runs out (evening golden hour).
- `sunniest` — the feasible slot with the highest *still-safe* average UV (max warmth / vit D).

---

## The scheduling engine (pure, testable — no calendar coupling)

Lives in `lib/scheduler.ts`, depends only on data, so it unit-tests like `lib/planner.ts`.

```ts
interface BusyInterval { start: number; end: number }   // hours within a day, [start, end)

interface SlotRecommendation {
  start: number        // recommended start hour
  end: number          // start + activity duration
  flexFrom: number     // full feasible free+safe interval this slot sits in
  flexTo: number
  windowLabel: SafeActivityWindow['label']  // Morning / Afternoon / Evening
  peakUV: number
  reason: string       // "earliest free time in your afternoon sun window"
}

function recommendSlot(
  safeWindows: SafeActivityWindow[],   // from getActivityWindow — already respects preferredHours + effectiveMaxUV
  busy: BusyInterval[],                // from calendar, clipped to this day
  durationMins: number,
  timePreference: TimePreference,
  nowHour: number,                     // -1 for future days; current hour for today (no past slots)
): SlotRecommendation | null
```

Algorithm:

1. For each safe window `[from, to)`, **subtract** the busy intervals → a set of free sub-intervals.
2. For today, drop/clip sub-intervals that end at or before `nowHour`.
3. Keep sub-intervals where `(end - start) * 60 >= durationMins`.
4. Among the survivors, choose by `timePreference`:
   - `earliest` → smallest `start`; recommended start = `start`.
   - `latest` → largest start that fits; recommended start = `end - duration`.
   - `sunniest` → sub-interval whose parent window has the highest `avgUV`; start at the
     highest-UV hour inside it that still fits.
5. Return the slot **plus** its containing interval as `flexFrom/flexTo` — that's the "5–7pm"
   flexibility the description shows.

Multi-day: run `recommendSlot` per day across the accessible forecast horizon (reuse the
`lib/planner.ts` pattern) → "best **day and time** this week." The 10-day Pro horizon makes
this materially better, so this is a natural Pro feature.

---

## Google Calendar integration (fits the static app — stays on Spark)

No backend required: the browser talks to the Calendar REST API directly with an OAuth access
token. (A server is only needed for Calendar *push/watch* webhooks, which we don't need for
on-demand scheduling. See `docs/DEPLOYMENT.md`.)

**Auth — use Google Identity Services (GIS) incremental authorization**, *not* scopes bolted
onto Firebase login. Calendar access is requested only when the user clicks "Connect calendar,"
decoupled from sign-in:

```ts
// google.accounts.oauth2.initTokenClient — request only when needed
scopes:
  - https://www.googleapis.com/auth/calendar.readonly   // free/busy query
  - https://www.googleapis.com/auth/calendar.events      // create the one confirmed event
```

**Read (privacy-friendly):** `POST /calendar/v3/freeBusy` returns **only busy time ranges, not
event titles or details** — a strong privacy story to surface in the consent UI ("Solara sees
when you're busy, never what you're doing").

**Write:** `POST /calendar/v3/calendars/primary/events` — created only after the user confirms
a recommendation. Never auto-write without confirmation.

Token is short-lived (~1h); request it at scheduling time and cache in memory for the session.

---

## Event description format

```
🏃 Running — your sun window

Booked for 5:00pm — the earliest you're free in your preferred afternoon window today.
Flexible: anywhere 5:00–7:00pm keeps you under UV 4 (no sunscreen).
Peak UV today is 7.8 at 3pm. Going after the peak means safer, still-sunny conditions.

Planned by Solara ☀️
```

Driven entirely by `SlotRecommendation` (`start`, `flexFrom/flexTo`, `peakUV`, `reason`) plus
`effectiveMaxUV(activity)` and the activity's sunscreen flag.

---

## UX flow

1. Activity card / edit modal gains **"Schedule with my calendar."**
2. Not connected → **"Connect Google Calendar"** (GIS consent, explains read = busy-only).
3. Solara queries free/busy for the horizon, runs `recommendSlot` per day.
4. Shows the pick: _"Best slot for Running: **Thu 5:00–5:45pm** — earliest free time in your
   afternoon sun window. Flexible 5:00–7:00pm."_ with **Book it** / **see other days**.
5. Confirm → create the event with the rich description.
6. **Fallback unchanged:** if the user doesn't connect, the existing `gcalLink()` template
   button still works.

---

## Phased rollout

- **Phase 1 — Engine + recommendation UI (no calendar).** Build/test `lib/scheduler.ts`
  (`timePreference`, flex range, duration sub-intervals). Show the recommended time on activity
  cards. Still book via the existing template link. _Ships value with zero new permissions._
- **Phase 2 — Read calendar.** GIS token client + free/busy. Recommendations now reflect real
  availability. Read-only, privacy-forward.
- **Phase 3 — Write calendar.** One-click create with the rich description; replaces the
  template link when connected.
- **Phase 4 — Plan-ahead + nudges (Pro).** "Best day *and time* this week"; optional
  notification: "Your 5pm run window is free Thursday — book it?"

---

## Open decisions (recommendation in **bold**)

1. **Auth pattern:** GIS incremental token client *(recommended)* vs. scopes on Firebase login.
2. **Default time preference:** `earliest` *(recommended — matches the example)*; expose
   `latest`/`sunniest` per activity.
3. **Slot granularity:** hourly *(recommended for v1 — forecast is hourly)* vs. 30-min.
4. **Calendars:** `primary` only *(recommended v1)* vs. all the user's calendars.
5. **Booking:** confirm-first *(recommended — never write without explicit confirm)* vs.
   auto-book.
6. **Tier:** free gets today/tomorrow; **the 10-day "best day & time" is Pro** (ties to
   monetization).

## Touch points in the current code

- `lib/types.ts` — add `timePreference`; new `SlotRecommendation` / `BusyInterval`.
- `lib/scheduler.ts` — **new** pure engine (Phase 1).
- `lib/gcal.ts` — **new** GIS auth + free/busy + event create (Phases 2–3).
- `lib/weather.ts::getActivityWindow` / `lib/planner.ts` — reused as the safe-window source.
- `components/EditActivityModal.tsx` — add `timePreference` control next to preferred hours.
- `components/ActivityCards.tsx` — "Schedule with my calendar" replacing/augmenting the
  current calendar button.
- `lib/firebase.ts` — Google provider already present; calendar scopes go through GIS, not here.
