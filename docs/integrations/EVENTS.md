# Linking live events (Wave 5 item 9)

_Scoped 2026-10-27 by lane INTEG._
_Every external fact below was checked against the cited page on 2026-10-27._

This is the design for [ROADMAP item 12.9](../ROADMAP.md#12-wave-5-features): linking events from Strava, Meetup and similar services so Solara can plan around them.
Phase 1 is built (see [Phase 1 as built](#phase-1-as-built)), phases 2 and 2b are built and switched off (see [Phase 2 as built](#phase-2-as-built) and [Phase 2b as built](#phase-2b-as-built)); phase 3 is still a plan.
Files marked "(new)" are planned.

## Phase 1 as built

_Built 2026-10-27 by lane EVENTS._

- **Where it shows:** an Events section on the dashboard, under the burn and vitamin D estimates, for every signed-in account (`components/events/EventsSection.tsx`, loaded on demand from `components/deferred.tsx`).
  The plan below says "the Scheduled view", but Scheduled is not a view of its own and is switched off until the Google OAuth client ID is set, so tying events to it would hide them in production.
  Guests do not see it; the plan comparison lists it as a Free and Pro feature.
- **Parser:** written for Solara in `packages/core/src/ics-parse.ts` with `packages/core/src/rrule.ts` and `packages/core/src/zoned-time.ts`, rather than a library.
  ical.js is the well-maintained choice, but it is about 25 KB gzip, more than this importer needs, and it would also have to be declared and bundled for Functions; node-ical is Node-only.
  The in-house reader covers what event feeds send (unfolding, escapes, UTC, floating and TZID times with IANA names, Windows names, Mozilla-style paths, `X-LIC-LOCATION` and VTIMEZONE rules; RRULE with DAILY to YEARLY, INTERVAL, COUNT, UNTIL, BYDAY with ordinals, BYMONTHDAY, BYMONTH, BYSETPOS and WKST; RDATE, EXDATE and RECURRENCE-ID overrides), rejects rules it cannot expand faithfully (reading only their first date), and has unit tests for each case, including RFC 5545's own examples and malformed input.
- **Limits:** 1 MB per file, 5,000 VEVENTs read, 200 events kept (the soonest), 50 occurrences per recurring event; recurring events are expanded over the next 10 days (the longest forecast), and a series with nothing in that range shows its next occurrence.
  One-off events more than a year ahead and events longer than a week are skipped; an event with no end or duration counts as one hour.
- **Bounded parsing (REVIEW4 M2):** one work allowance per file (200,000 units, at most 20,000 per recurring event) is counted inside the recurrence expansion, VTIMEZONE conversions and RDATE/EXDATE lists, so no file takes more than about half a second; a series that needs more is reported as too complex to read.
  COUNT rules with a fixed number of occurrences per period (DAILY, WEEKLY) skip whole periods by multiplying, nesting stops at 6 levels, and the app parses in a Web Worker (`lib/ics-worker.ts`) stopped after 20 seconds, so the page stays responsive whatever the file holds.
  The same bounds make the parser safe for phase 2's Function.
- **Text:** bidirectional controls and zero-width spaces are removed from titles, places and the calendar name (REVIEW4 L2), so a title cannot display differently from what it says.
- **Places:** `GEO` is used as given (named by the first part of `LOCATION`, else by the reverse lookup in `lib/geocoding.ts`); `LOCATION` text is searched at town level with the existing place search and its rate limit and cache, picking the same-named town nearest the person, with at most 10 lookups per import, searches and reverse lookups together (REVIEW4 L3); a `GEO` point past that takes the name of a found place within 10 km, else "Event location".
  Anything else uses the person's place and says so, with "Set the place", which moves every occurrence of that event.
  Re-importing keeps the place and activity the person chose.
- **Re-imports (REVIEW4 L1):** importing a calendar again removes stored events it cancels (`STATUS:CANCELLED` on an event or an occurrence) and occurrences of a recurring event it no longer produces within the range it was read for.
  A one-off event deleted from the source stays until it ends: a file does not say which calendar it came from, so its absence cannot be told apart from an event of another file.
- **UV source:** the forecast hours at the event's place through core's `planningUV` (#114), as the app plans windows: a clear sky unless the event's activity plans with the clouds, then its shade and surface.
  An event four or more days ahead carries the forecast's fair or low confidence note (#110).
- **Storage:** `users/{uid}/events/{key}` as planned, typed and capped in `packages/core/src/events.ts` and `firestore.rules`, with `expireAt` (30 days after the end) for the TTL policy in `infra/firestore-ttl.sh`, in the account export (`importedEvents`) and removed by account deletion with the rest of `users/{uid}`.
  `expireAt` may be at most 31 days after the end (the rules read the date from `end`).
- **Per-account cap (REVIEW4 M4):** at most 1,000 imported events and 500 scheduled activities per account (default, owner may change).
  The rules cannot count documents, so `users/{uid}/meta/events` and `users/{uid}/meta/scheduled` list every record's key: a record is written only in a batch that lists its key, the list holds at most the cap, and a key comes off only in a write that names it and after which its record is gone (`lib/key-index.ts`).
  Keys of records Firestore's TTL policy deleted are taken off when a save would otherwise not fit; the Events section says when the account is at the cap, and an import says how many events did not fit.
  A phase 2 Function writes with the Admin SDK, which skips the rules, so it must keep the list the same way.
- **List and "Remove all" (REVIEW4 M3):** the section reads the 200 soonest-ending events that have not ended, however many later ones are stored, and "Remove all" deletes every stored event, page by page (since REVIEW5 L2 it is "Remove imported events" and keeps linked and Google Calendar events, which come back at their next refresh).
- **Not in phase 1:** sharing a file to the installed app (Web Share Target), the "better window" suggestion for events the person controls, and keeping recurring events current beyond 10 days without importing again (phase 2's subscriptions do that).

## Phase 2 as built

_Built 2026-10-28 by lane EVENTS2, switched off behind `EVENTS_SUBSCRIPTIONS_ENABLED` ([DEPLOYMENT.md](../DEPLOYMENT.md#linked-calendars-and-event-heads-ups))._

- **Who:** every signed-in account can link calendars, like the file import (the plan's default for who gets event linking); heads-ups are Pro, with the morning and UV alerts.
- **Where it shows:** "Linked calendars" at the bottom of the Events section (`components/events/EventSubscriptions.tsx`), loaded only when the feature is on, so neither the guest's nor the signed-in first load grows (the guest first load measured 189.1 KB, as on `main`).
  Each link shows its label (the person's, else the calendar's `X-WR-CALNAME`, else its host), its host, when it was last updated and how many upcoming events it holds, and what went wrong if a check failed.
  Events from a link say "From a linked calendar" and have no remove button of their own, because the next refresh would bring them back; removing the link removes them.
  Settings, **Morning and UV alerts**, gains an "Event heads-up" switch for Pro.
- **Fetcher** (`functions/src/events/safe-fetch.ts`): as the plan's guards, with these choices: port 443 only; the connection is pinned to the address that was checked (a custom DNS `lookup`), so DNS rebinding cannot swap it; one private answer among several blocks the host; IPv6 must be global unicast outside its special blocks, which also refuses IPv4-mapped, NAT64 and 6to4 forms; `localhost` and names under the `local` and `internal` domains, metadata host names included, are refused before any lookup; the 10-second deadline covers redirects and decompression too, and the fetch settles by then whatever the site does; gzip, deflate and brotli bodies are limited on the wire and after decompression, read as one stream pipeline so a corrupt or oversized compressed body fails only that fetch (REVIEW5 H1; `readBoundedBody` and `withDeadline` are exported for any other server fetch of untrusted bodies); the content type must be a calendar or a generic type and the body must start with `BEGIN:VCALENDAR`; `ETag` and `Last-Modified` make later fetches conditional.
- **Storage:** as planned the address is a credential, but instead of `users/{uid}/private/eventSources` (which the owner can read) it lives in the top-level, server-only `eventSubscriptions/{id}` with its refresh state, and the app reads a summary without the address from `users/{uid}/private/eventSubscriptions`.
  A top-level collection also lets the refresh job find due links with one single-field query (`due`).
  Events go in `users/{uid}/events` with `source: 'feed'` and `feedId`; their keys hash the link's id with the UID, so the same event in a file or another link never shares a record.
  The rules refuse client-created `feed` events and allow the app to change only their place and activity (`FEED_EVENT_CLIENT_FIELDS`); the Function keeps the per-account key list itself, in the same transaction as the events, and takes off keys of records the TTL policy deleted when a refresh would otherwise not fit.
- **Refresh:** every 6 hours, by the `eventSubscriptionsRefresh` job every 30 minutes, which takes every due link oldest due first, 16 at a time, up to 3,000 a run and 200 seconds, and gives each link at most 90 seconds (REVIEW5 M4); a refresh replaces the link's upcoming events (so cancelled and deleted events go, which phase 1 cannot do for one-off events) and keeps the place and activity the person set while the event's location text is unchanged.
  Each attempt claims its link before fetching (`functions/src/events/lease.ts`): in one transaction its next refresh time moves to the retry time it would get if it failed, so a link that hangs or crashes its instance cannot hold the head of the queue, and the next attempt counts an attempt that never reported back as a `timeout` failure (REVIEW5 H1).
  A refresh reads the link's stored events once and writes only the events that are new or changed; an answer with the same bytes as the last one is not parsed again for a day, unless some of its stored events are gone (REVIEW5 M2).
  A link still due a whole extra 6 hours after its time makes the job log an ERROR, which emails the owner.
  Failing links back off 6, 12, 24 and 48 hours and are paused after 7 days until the person presses Refresh; the job and the endpoint stop while the cost guard is engaged.
- **Places:** `GEO` as given, named by the `LOCATION` text's first part or a found place within 10 km; `LOCATION` text searched at town level with the commercial place search, once per text per link (the answer is kept on the link), at most 10 a refresh, from a budget of its own (50 an hour, 300 a day, 10 an hour per account; REVIEW5 M1), never place search's; otherwise the person's place, marked as guessed, replaced by the found place once a later refresh finds it (a place the person set is kept).
  Unnamed `GEO` points are not reverse-geocoded on the server (Nominatim's policy forbids bulk use from a server); they read "Event location".
- **Heads-ups:** in the `alerts` job (`functions/src/notifications/alerts.ts`, timing and words in `packages/core/src/event-heads-up.ts`): for each entitled Pro account with no morning or UV alert in that run, its next events in 20 hours are checked, and an event whose peak UV at its place reaches 6 (WHO "high", after the activity's shade and surface, with clouds counted as the app does) gets one push about 3 hours before the start.
  When that falls in quiet hours the heads-up moves to the last hour before they began (the evening before an early start), and it never goes out later than 15 minutes before the start.
  Event forecasts come from the shared cache within the global upstream budget and the account's share of it (FIX4A), at most 200 lookups a run.
- **Account data:** removing a link first marks it `removing`, so no refresh writes for it, then deletes its events with their keys, then the link and its summary entry; a removal that stops halfway leaves the link listed, and pressing Remove again or the scheduled run an hour later finishes it (REVIEW5 L2).
  No refresh or removal writes anything under an account that is deleted or being deleted (REVIEW5 L3).
  The Events section's "Remove imported events" keeps linked events; a linked event deleted any other way is written back at its link's next refresh, even when the calendar has not changed.
  Account deletion deletes the account's links; the export lists the links' summaries (never the addresses) and the heads-ups of the last week; the privacy policy describes linked calendars.
- **Not in phase 2:** a label field in the form (the calendar's own name is used); naming the link on each event; reverse lookups of unnamed points on the server.

## Phase 2b as built

_Built 2026-10-28 by lane GCAL, switched off until the Google OAuth client ID and `GOOGLE_CALENDAR_EVENTS_ENABLED` are set ([DEPLOYMENT.md](../DEPLOYMENT.md#events-from-google-calendar), [owner checklist](../OWNER_CHECKLIST.md#events-from-google-calendar))._
_Every choice below is a default the owner may change (ROADMAP decisions, 2026-10-28)._

- **Who and where:** every signed-in account, like the file import; a "Google Calendar" panel in the Events section (`components/events/GoogleCalendarEvents.tsx`), loaded only when switched on, so neither first load grows.
  Events from it say "From Google Calendar" and, like linked calendars' events, have no remove button of their own: Disconnect removes them, and "Remove imported events" keeps them (REVIEW5 L2).
- **Scope:** `calendar.events.readonly` ("View events on all your calendars"), the least privilege that sees every calendar the person reads, subscribed ones included; `calendar.readonly` would also read calendar settings and sharing, and `calendar.events.owned` cannot see subscribed calendars and is promised to Scheduled's own events.
  Choosing calendars other than the main one asks separately for `calendar.calendarlist.readonly` ("See the list of Google calendars you're subscribed to").
  Both are sensitive scopes with their own verification (a demo video and a justification, [owner checklist](../OWNER_CHECKLIST.md#events-from-google-calendar)), kept out of the pending Scheduled request so it is not delayed.
  The phase plan said `calendar.events.readonly` too; it is unchanged.
- **Client only, no refresh tokens:** Google Identity Services' token model in the browser, incremental and separate from Scheduled's scopes, tokens in memory only (`lib/gcal.ts`).
  Storing refresh tokens would need the code flow with the client secret in a Function, Blaze, an encrypted token store and a refresh job, for a feature whose events change rarely; it is not needed.
  The cost: events refresh only while Solara is open, by themselves every 30 minutes while the session holds a token (about an hour after a consent) and otherwise when the person presses Refresh (Google needs a click to show its popup).
  The stored events stay in between, so the Pro heads-ups of phase 2 work from them as for imported events.
- **What is read and kept:** the chosen calendars (main one by default, at most 10), the next 30 days, recurring events expanded, at most 4 pages of 250 events per calendar, with `fields` limited to id, iCalUID, status, title, location, times, the recurrence's original start, whether the person declined, and private properties (to skip Solara's own scheduled windows).
  Kept: timed events that are not declined, last at most a week, and have a location that is not a link (video calls are dropped, never stored, as their links can hold passcodes) or a title matching one of the person's activities.
  Each is stored like an imported event (`source: 'google'`): title, time, zone, location text, place and activity, no link; at most 200 per refresh, the soonest.
  Unchanged events are not written again.
- **Places:** the location text is searched at town level as for the file import (at most 10 lookups a refresh, places already found reused); otherwise the person's place, marked as guessed; the person's place and activity choices stay while the location text is unchanged.
- **Cap and keys:** Google events count toward the account's 1,000 events through the same key list (`lib/key-index.ts`), written by the app under the rules; a refresh removes stored Google events that are gone (deleted, moved past the window, declined, or on a calendar no longer chosen) before saving, so they make room, and says how many did not fit.
- **Duplicates:** the same event on two chosen calendars is stored once (keys hash the iCalUID and occurrence); an event already in Solara from a file (same UID and occurrence, so the same key an import would give) or from any source with the same title, start and end is not stored again; a later import of the same event wins, because the next refresh drops the Google copy.
- **Connection:** `users/{uid}/meta/googleCalendar` (the chosen calendars' ids and names, the main one as `primary`, never its email address; when it was connected and last read), typed and capped by the rules, so every device reads the same calendars and a disconnect on one device holds on all.
- **Disconnect:** removes every `google` event and the connection, then revokes the grant through GIS; Google's revoke ends all of Solara's calendar access at once, so Scheduled asks to connect again, and the confirmation says so.
  Without a token in this session there is nothing to revoke with; the message then points to the Google Account connections page.
- **Account data:** the export gains `googleCalendar` (the chosen calendars) and lists Google events in `importedEvents`; account deletion removes both with `users/{uid}`; the privacy policy describes the scopes, what is kept and for how long.
- **Heads-ups:** REVIEW5 M3 found that heads-ups treat every event as outdoors; lane FIX5B limits them to outdoor events (an activity set) and de-duplicates them across sources.
  Google events without a matching activity are stored with no activity, so that rule leaves them out; the owner checklist puts FIX5B before switching this on.
- **Not in phase 2b:** a server refresh while Solara is closed; per-calendar colours or names on each event; reading events further than 30 days ahead.

## Recommendation in short

Build on the iCalendar (.ics) format first, not on partner APIs.
Almost every event service (Meetup, Eventbrite, race sites, club sites, Google and Apple Calendar) offers an "Add to calendar" download or a calendar feed, so one importer covers them all with no developer account, no app review and no partner terms.

1. **Phase 1 (Spark, client only, no approvals):** import a .ics file and show the UV at each event's time and place, with sunscreen timing.
2. **Phase 2 (Blaze, no partner approval):** subscribe to an .ics or webcal link that Solara refreshes on the server, and send a Pro heads-up before an event with high UV.
3. **Phase 2b (optional, Google verification only):** read events the person already has in Google Calendar.
4. **Phase 3 (Blaze plus a Strava developer subscription; review past 10 athletes):** connect Strava for "UV during this run" recaps and planning from saved routes.

Do not build on the Meetup, Eventbrite, Komoot or Garmin APIs; the reasons are in [Sources compared](#sources-compared).

## What Solara does with an event

An event is a title, a start and end instant with a time zone, and a place.
For each one, Solara shows:

- **UV during the event:** the peak and average UV between its start and end, from the hourly forecast at its place, with the WHO band.
- **Exposure:** the event is matched to one of the person's activities (by keywords such as run, hike, ride or swim, which the person can change), so the shade and surface factors from item 8 (`packages/core/src/exposure.ts`) and the burn time for the planning profile apply.
- **Sunscreen timing:** apply 15 to 30 minutes before the start, and reapply every 2 hours or after swimming or heavy sweating, shown only when the peak UV is 3 or more.
- **A better window, when there is one:** for events the person controls (a solo run), the existing recommendation engine suggests a lower-UV start nearby; for fixed events (a race, a group meetup) Solara only advises.
- **Forecast horizon:** events beyond the person's plan (today for guests, two days on Free, 10 days on Pro) show "Forecast from <date>" instead of numbers, and the item becomes live when the forecast reaches it.
- **Heads-up (Pro, Blaze):** a push the evening before, or a set time before the start, when the event's peak UV is high; this reuses the morning alerts Function and device tokens of [ROADMAP item 10](../ROADMAP.md#10-wave-3-phase-2-pro-only-morning-alerts-w3-b-built) and the threshold alerts of item 12.2.
- **After the event (Strava, phase 3):** a recap of the UV during a recorded activity, from its start time, elapsed time and start point.

All of this is pure, deterministic logic over data the app already fetches, so it belongs in `packages/core/src/events.ts` (new), shared by the app and the Functions that send heads-ups.

### Place and time

- **Place:** the iCalendar `GEO` property gives coordinates when present.
  Otherwise the `LOCATION` text is geocoded at city level with the place search the app already uses (`lib/geocoding.ts`); UV varies little within a city, so this is accurate enough.
  When neither works, the event uses the person's current location and says so ("Using San Diego; set the place"), with a place picker to fix it.
  Real feeds often omit the place: a public Meetup group feed checked on 2026-10-27 (`https://www.meetup.com/bostonpython/events/ical/`) returned ten events with `DTSTART;TZID=...` and `URL` but no `LOCATION` or `GEO`.
- **Time:** events are stored as UTC instants plus their IANA zone (`TZID`), and converted to the place's zone for display with the existing helpers in `lib/time.ts`.
  This differs from Solara's own export (`lib/ics.ts`), which writes floating local times on the assumption that the device zone is the location zone; imported events must not rely on that assumption.
- **Recurrence:** `RRULE` events (a weekly club run) are expanded only over the forecast horizon, at most 50 occurrences per source.

## Sources compared

Ranked by user value against integration cost and approval or terms risk.

| Rank | Source | User value | Cost | Approval and terms risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | .ics file import | High: covers Meetup, Eventbrite, races, club sites, any calendar | Low, client only | None | Phase 1 |
| 2 | .ics or webcal link subscription | High: stays current without re-importing | Medium: a Function fetcher with SSRF guards | None from partners; needs Blaze | Phase 2 |
| 3 | Google Calendar events | High for people who already put events there | Low: the GIS integration exists (`lib/gcal.ts`) | Medium: a broader scope to verify and a privacy promise to change | Phase 2b, optional |
| 4 | Strava | Medium: no future events in the API; recaps and routes only | High: server OAuth, token storage, webhooks | High: subscription, 10-athlete cap, display and AI limits | Phase 3 |
| 5 | parkrun | Medium in the UK and Australia | None: a preset recurring activity, no API | Low if no parkrun data is fetched | An activity preset, not an integration |
| 6 | Meetup API | Same as Meetup's .ics feeds | High | High: Meetup Pro to create an OAuth client, approval not guaranteed | Not recommended |
| 7 | Eventbrite API | Low: no public event search | Medium | Medium | Not recommended; use .ics |
| 8 | Komoot | Medium | High | Blocking: partner contract only | Not recommended |
| 9 | Garmin Connect | Medium | High | Blocking: new approvals paused | Not recommended |
| 10 | Google Fit, Apple Health, Health Connect | Low for planning | High | Google Fit ends with 2026; the others are native only | Wave 6 (mobile app) at most |

### iCalendar (.ics) import and subscriptions

- iCalendar is an open standard (RFC 5545), so there is no partner, no review and no terms beyond each feed's own site.
- A browser cannot fetch most feed URLs directly: Meetup's feed answered with no `Access-Control-Allow-Origin` header on 2026-10-27, and the app's Content Security Policy (`lib/csp.mts`) rightly limits `connect-src` to known origins.
  So a file the person picks (or shares to the installed app) works on Spark, while a subscription URL needs a server fetch, which needs Blaze.
- Meetup group feeds have the form `https://www.meetup.com/<group>/events/ical/` and answered `200 text/calendar` without sign-in; some group slugs returned 404 or 403, so the importer must show a clear error for a feed it cannot read.
- Feed URLs can embed private tokens (Google's "secret address in iCal format", Solara's own feed), so a stored URL is treated as a credential.

### Google Calendar

- Solara holds two scopes today, each requested only when needed (`lib/gcal.ts`): `calendar.freebusy` (busy times only) and `calendar.events.owned` (create, view, change and delete events on calendars the person owns).
  Source: <https://developers.google.com/workspace/calendar/api/auth>.
- `calendar.events.owned` could technically read the person's own events, but the privacy policy (`app/privacy/page.tsx`) and the verification justification in the [owner checklist](../OWNER_CHECKLIST.md#google-sign-in-and-calendar) promise that Solara reads only events it created.
  Using it for other events would need a new privacy text and a new justification, and it still would not see subscribed calendars (a Meetup feed added to Google), which are not owned.
- `calendar.events.readonly` sees every calendar, including subscribed ones, at the cost of a broader sensitive scope and its own verification with a demo video.
  Google's sensitive-scope verification is described at <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>; the console's Data Access page shows the exact classification of each scope.
- Default: do not add this scope to the pending verification of the two current scopes (owner step 4), so Scheduled is not delayed; request it separately once phase 2b is built and has a demo.

### Strava

- **No future events.** The API reference lists clubs only as Get Club and List Athlete Clubs, with no club or group events endpoint, and no event search (checked against <https://developers.strava.com/docs/reference/> and its Swagger file, <https://developers.strava.com/swagger/swagger.json>).
  The Club Activities, Club Members and Club Admins endpoints are removed on 2026-09-01 (<https://developers.strava.com/docs/changelog/>).
  What remains useful: recorded activities (`start_date`, `start_latlng`, elapsed time) for after-the-fact UV recaps, and saved routes as start points for planning.
- **Scopes** (<https://developers.strava.com/docs/authentication/>): `read`, `read_all`, `profile:read_all`, `profile:write`, `activity:read`, `activity:read_all`, `activity:write`.
  Solara would need only `activity:read` (recaps, and required for activity webhooks) and `read_all` only if private routes are wanted; athletes can untick scopes, so the granted set must be checked.
- **Tokens:** access tokens last six hours; every refresh returns a new refresh token and invalidates the old one, so the latest must be stored.
  The code exchange needs the client secret, so it must run in a Function, never in the browser.
  Deauthorization moves to `POST https://www.strava.com/oauth/revoke` (available since 2026-06-01; the old `oauth/deauthorize` is retired on 2027-06-01), and on 2027-06-01 tokens must go in headers and the base URL becomes `https://api-v3.strava.com`.
- **Rate limits** (<https://developers.strava.com/docs/rate-limits/>): 200 requests per 15 minutes and 2,000 a day overall, 100 and 1,000 for reads.
  A new app is in Single Player Mode (only the developer's own data); a self-upgrade in the API settings allows 10 athletes, and more than 10 needs app review with screenshots of where Strava data appears and the "Connect with Strava" button.
- **Developer program** (<https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>): since 2026-06-01, Standard Tier API access requires a Strava subscription on the developer's account; Extended Access (more athletes, higher limits) is by approval and exempt.
  Apps that route Strava data through third-party intermediaries are no longer supported, so the integration must be direct.
- **Webhooks** (<https://developers.strava.com/docs/webhooks/>): one subscription per app; activity create, update and delete, and athlete deauthorization; the callback must answer within two seconds; payloads carry ids only, so details are fetched afterwards.
- **API Agreement** (<https://www.strava.com/legal/api>, effective 2026-06-01):
  - Strava data from a user may be shown only to that user, never to other users, even if it is public on Strava.
  - Apps may not compete with or replicate Strava functionality.
  - On termination all Strava data must be deleted and the deletion certified in writing.
  - Strava may charge for API access in the future, with notice.
- **AI:** the November 2024 update barred using API data in AI models or similar applications, and Strava says to ask for written guidance first (reported by DC Rainmaker, <https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html>).
  So Strava data must never reach the optional AI-written briefing (item 12.3) or any other model.

### Meetup

- Meetup's API is GraphQL behind OAuth 2 bearer tokens, with a budget of 500 query points every 60 seconds (<https://www.meetup.com/api/guide/>).
- API access is listed as a Meetup Pro feature (<https://www.meetup.com/api/general/>), and Meetup's help centre says only members with an active Pro subscription can create OAuth consumers and that Pro does not guarantee approval (help article 41453576628749 on help.meetup.com, which blocked automated fetching on 2026-10-27; quoted from search results).
- The guide does not document searching events by location.
- The group .ics feeds give the same events with no account, so the API adds cost and approval risk for little gain.

### Others

- **Eventbrite:** the public event search endpoint was removed in 2020 and the API now serves an organizer's own events (reported in <https://github.com/Automattic/eventbrite-api/issues/83>); attendees get .ics downloads from event pages, which phase 1 covers.
- **Komoot:** the API is for partners with a signed contract only (<https://static.komoot.de/doc/external-api/v007/index.html>).
- **Garmin Connect Developer Program:** free for approved business developers (<https://developer.garmin.com/gc-developer-program/program-faq>), but Garmin has paused new approvals (reported in <https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/>).
- **parkrun:** no public API was found; parkrun is a fixed weekly 5 km at a known place and time, so a "parkrun" activity preset with a recurring Saturday start covers it without fetching parkrun data.
- **Google Fit:** sign-ups closed on 2024-05-01 and the APIs, the REST API included, are supported only until the end of 2026, in favour of Health Connect, which is Android only (<https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq>); Apple Health is iOS only.
  Both belong to the Wave 6 mobile app if anywhere, and they hold past workouts, not planned events.

## Phased plan

### Phase 1: .ics file import (Spark, client only)

- **Scope:** signed-in people pick a .ics file (or, in the installed app on Android, share one to Solara through a Web Share Target); Solara parses it in the browser, shows the events in an "Events" section of the Scheduled view, and stores them in Firestore so every device sees them.
- **Parser:** `packages/core/src/ics-parse.ts` (new), next to the existing serializer, handling line unfolding, escaping, `TZID` with `VTIMEZONE`, `DTSTART` as a date (all day, skipped), `RRULE` over the horizon, `GEO`, `LOCATION`, `URL`, `UID` and `STATUS:CANCELLED`.
  Limits: 1 MB per file, 200 events per import, text fields capped like `SCHEDULED_LIMITS` in `packages/core/src/scheduled.ts`.
- **Storage:** `users/{uid}/events/{eventKey}` (new subcollection), with the source (`file`), title, start, end, zone, place (coordinates, label, and whether it was guessed), matched activity id, the source `URL` if it is a `https` link, and a TTL field like scheduled activities so past events expire 30 days after they end.
  The key is a hash of the source and `UID` (plus the occurrence for recurring events), so re-importing the same file updates instead of duplicating.
- **Guests:** not offered; a guest's plan covers only today, and the sign-in prompt explains the feature.
- **UI:** an event card with the UV during the event, burn time, sunscreen timing and the "set the place" fix; the visual design follows the preview-before-polish rule (desktop, then mobile, approved before tests).
- **Size:** M.

### Phase 2: link subscriptions and heads-ups (Blaze)

- **Scope:** paste an `https` or `webcal` link; a Function fetches it now and again every few hours, and the events update in place.
- **Fetcher** (`functions/src/events/` (new)): an authenticated callable to add, refresh and remove a source, and a scheduled refresh for active sources.
  Guards: `https` only (webcal is rewritten), DNS resolution checked against private, loopback and link-local ranges on every redirect (at most 3), a 10-second timeout, a 1 MB body cap, `text/calendar` or a parse that succeeds, at most 5 sources per person, a per-uid rate limit (`functions/src/shared/rate-limit.ts`) and the cost guard (`functions/src/shared/cost-guard.ts`).
  Failing sources back off and show their error; a source that fails for 7 days is paused.
- **Storage:** the source URL is a credential, so it lives in `users/{uid}/private/eventSources` (server-written, owner-readable, already covered by `firestore.rules`), shown to the person only as its host and a label.
  Events go in the same `users/{uid}/events` subcollection, written by the Function.
- **Heads-ups:** a Pro push before a high-UV event, built into the item 10 alert Function rather than a second scheduler.
- **Size:** M, after item 10.

### Phase 2b: events already in Google Calendar (optional, built)

As built, see [Phase 2b as built](#phase-2b-as-built): 30 days rather than 10, and events are stored like imported ones (instead of only pinned ones) so other devices and the heads-ups see them.

- **Scope:** with `calendar.events.readonly`, requested only when the person turns this on, Solara lists the next 10 days of events with a place, in the browser, and offers the same UV card; nothing is stored except events the person pins.
- **Needs:** a new privacy policy section, a verification request with a demo video, and an update to the CSP only if a new origin is called (the Calendar API origin is already allowed).
- **Size:** S to M, plus Google's review time.

### Phase 3: Strava (Blaze, Strava developer subscription)

- **Scope:** "Connect with Strava" (official button and "Powered by Strava" mark per Strava's brand guidelines), then a UV recap on each new outdoor activity and an option to plan from a saved route's start point.
- **Server:** an OAuth callback Function exchanges the code; the refresh token is stored server-only; a webhook Function answers within two seconds and queues the fetch; deauthorization (from Solara, from Strava, or by account deletion) calls `oauth/revoke` and deletes every stored Strava record.
- **Storage:** `stravaLinks/{athleteId}` (new, top level, server-only) maps the webhook's `owner_id` to the Solara uid and holds the tokens; recaps live in `users/{uid}/events` with source `strava`.
- **Rules of use:** Strava data is shown only to the athlete who linked it, never fed to an AI model, and never shared or exported to anyone else.
- **Launch:** 1 athlete (the owner) in Single Player Mode, then 10 by self-upgrade for a beta, then app review for more.
- **Size:** L.

## Security and privacy

- **Least privilege:** phase 1 needs no new permission at all; phase 2b asks for the Calendar read scope only when turned on; Strava asks for `activity:read` only, plus `read_all` only if private routes are offered.
- **Where secrets live:** Strava's client secret and webhook verify token are Functions secrets (Secret Manager), never `NEXT_PUBLIC_*` values; Strava refresh tokens live in `stravaLinks`, which `firestore.rules` denies to every client (`allow read, write: if false`); subscription URLs live in `users/{uid}/private`, which only the Functions write and only the owner can read, and the UI shows just each URL's host.
  Google tokens stay in browser memory as today.
- **Rules:** `users/{uid}/events/{eventKey}` gets the same pattern as `scheduled`: owner-only, the account active, a key allowlist, typed and length-capped fields, a TTL field checked on write, and list queries capped (`limit <= 200`).
  In phase 1 the client writes events; once phase 2 ships, events whose source is a subscription or Strava are server-written and the rules refuse client writes for those sources.
  New rules tests go in the existing rules suites (`lib/firestore-rules.test.ts` and the emulator tests).
- **Unlinking:** removing a source deletes its events and its stored URL; disconnecting Strava revokes the token at Strava and deletes `stravaLinks/{athleteId}` and every Strava-sourced event.
- **Account deletion:** `functions/src/account/deletion.ts` already deletes `users/{uid}` recursively, which covers the events subcollection and the private sources document; the top-level `stravaLinks` documents need an explicit step beside `deleteCalendarFeedsForUser`, including the Strava revoke call.
- **Export:** `functions/src/account/export.ts` adds the person's events and source labels (not the secret URLs or tokens).
- **Data minimisation:** only what the UV card needs is stored (no attendee lists, descriptions or organiser details), and past events expire through TTL.
- **Strava's deletion clause:** if Solara stops using the API, all Strava data must be deleted and the deletion certified to Strava, so the plan for that case must account for Firestore backups, which are kept for 14 days, and point-in-time recovery, which covers 7 ([RUNBOOK.md](../RUNBOOK.md)).
- **Disclosures:** the privacy policy gains sections for imported events, link subscriptions (the Function fetches the link from Google Cloud), the Calendar read scope and Strava, before each ships.

## Owner decisions and actions

Decisions, with the default agents follow until the owner says otherwise:

| Decision | Default |
| --- | --- |
| Approve the phased plan and the ICS-first approach | Phase 1 is buildable now; later phases wait for this approval |
| Who gets event linking | Every signed-in person; the existing forecast horizon (Free two days, Pro 10 days) and Pro-only push are the upsell, so no new gate |
| Add `calendar.events.readonly` to the pending Calendar verification | No; request it separately once phase 2b is built |
| Build the Strava integration | Only after phases 1 and 2 show use, and only with the owner's Strava subscription |

Actions, only when the matching phase starts:

| Phase | Action | Cost |
| --- | --- | --- |
| 1 | None | $0 |
| 2 | Blaze, already planned for the Pro launch ([COSTS.md](../COSTS.md)); then the [Linked calendars](../OWNER_CHECKLIST.md#linked-calendars) checks and `EVENTS_SUBSCRIPTIONS_ENABLED` ([step 17](../OWNER_CHECKLIST.md#at-pro-launch-blaze)); the refresh job takes every due link, about 1,600 a run at 2 seconds each ([COSTS.md](../COSTS.md)) | Within the free tier at launch scale |
| 2b | Add `calendar.events.readonly` and `calendar.calendarlist.readonly` on the Data Access page, record a demo video (an agent can script it), submit it in the Verification Center, then set `GOOGLE_CALENDAR_EVENTS_ENABLED` ([owner checklist](../OWNER_CHECKLIST.md#events-from-google-calendar)) | $0; Google's review time |
| 3 | Subscribe to Strava on the developer account; create the API application at <https://www.strava.com/settings/api> (name, website `https://solara-uv.web.app`, callback domain); give the client id and secret to the Functions secrets; self-upgrade to 10 athletes for a beta; later submit the Developer Program review form with screenshots | A Strava subscription at Strava's current price; the API itself is free |
| Never | A Meetup Pro subscription, Eventbrite, Komoot or Garmin developer accounts | Not needed |
