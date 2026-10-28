# Add a calendar from...

_Scoped 2026-10-28 by lane CALSCOPE, planned and owner approved 2026-10-28 ([ROADMAP item 24](../ROADMAP.md#24-add-a-calendar-from-helper-built-and-switched-off))._
_Every provider step below was checked against the cited page on 2026-10-28; steps that only third-party pages describe are marked "unconfirmed" and listed in [Open questions](#open-questions)._

This is the spec for a helper in the Events section that shows people how to get a calendar link from Apple iCloud, Google, Outlook.com and Yahoo, and recognises and checks the link they paste before it reaches [linked calendars](EVENTS.md#phase-2-as-built) (#131, ROADMAP item 19).
It changes nothing on the server: the link goes through the same `eventSubscriptions` Function, guards and limits as any pasted link.
It ships with linked calendars, so it is switched off with them behind `EVENTS_SUBSCRIPTIONS_ENABLED`.
Files marked "(new)" were planned here and are now built; what differs from the plan is in [As built](#as-built).

## What the person sees

- Under "Linked calendars" (`components/events/EventSubscriptions.tsx`), a link-styled button, "Add a calendar from...", opens a small panel with four choices: Apple iCloud, Google, Outlook.com and Yahoo.
- Choosing one shows that provider's steps (computer and phone where they differ), one sentence per step, then the same link field and "Link calendar" button.
- As the person pastes, the field names the provider it recognises ("Looks like a Google Calendar secret address") or explains what is wrong before anything is sent ("That is Google's public address. Copy the secret address instead.").
- Every provider panel ends with the same two notes: the link works like a password, and Solara refreshes it about every 6 hours.

## Code shape

- `packages/core/src/calendar-providers.ts` (new): a pure `recogniseCalendarLink(text)` that returns `{ provider, kind, problem }` from the rules in [Recognising links](#recognising-links), shared by the app and, as a hint in error messages, by the Function; unit tests with one real-shaped example per rule (made-up tokens).
- `components/events/AddCalendarGuide.tsx` (new): the panel and copy, loaded with the linked calendars UI (only when switched on), so neither first load grows.
- The copy lives in one object per provider, so the owner can change wording without touching logic, and a test checks every step is one sentence under 120 characters.
- A recognised provider is shown on the link's card ("Google Calendar", "iCloud"), replacing the bare host when the calendar sends no name.

## Privacy rules shown to everyone

- A calendar link is a key: anyone who has it can read every event on that calendar, so keep it private and paste it only into apps you trust.
- Solara keeps the link on its server, never shows it again, and shows only its site (as linked calendars already do).
- If a link leaks, reset or turn off sharing at the provider (steps below); the old link stops working there, and Solara's link then reports that it cannot read it, so remove it and add the new one.
- Prefer a separate calendar for outdoor plans (for example "Runs" or "Club rides") over your main calendar: it shares less, and it stays under Solara's 1 MB limit, which a main calendar with years of history can pass (`EVENT_SUBSCRIPTION_LIMITS.maxBytes` in `packages/core/src/event-subscriptions.ts`).

## Refresh lag

- Solara fetches each link about every 6 hours (`refreshHours`), and Refresh fetches it at once, at most every 10 minutes per link.
- Providers may also serve a cached copy, and Microsoft says only that how often a subscribed calendar syncs "depends on the recipient's email provider" ([Outlook.com sharing](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-com)); none of the four documents how fresh its feed is.
- So the copy promises nothing faster: "Changes can take a few hours to show in Solara."

## Apple iCloud

Sources: [iCloud on the web, share a calendar](https://support.apple.com/guide/icloud/share-a-calendar-mm6b1a9479/icloud), [iPhone User Guide, share iCloud calendars](https://support.apple.com/guide/iphone/share-icloud-calendars-iph7613c4fb/ios).

- **Computer or tablet (iCloud.com):** go to icloud.com/calendar and sign in; hover over the calendar in the sidebar and click its Information button (on a tablet, tap it); turn on **Public Calendar**; click **Copy**.
  Apple: "Only the calendar's owner can share a public calendar", and on the web "you need a tablet or computer".
- **iPhone or iPad (Calendar app):** tap **Calendars**, tap the Info button next to the iCloud calendar, turn on **Public Calendar**, then tap **Share Link** to copy or send the address.
  Apple: "Anyone you send the URL to can use it to subscribe to the calendar".
- **What the link looks like:** `webcal://p##-caldav.icloud.com/published/2/<long token>`, where `##` is a server number that varies; older links use `p##-calendars.icloud.com` (third-party examples, unconfirmed by Apple).
- **Turning it off or resetting:** turn **Public Calendar** off to stop sharing; turning it on again gives a new link (third-party guides; Apple's pages do not say, unconfirmed).
- **Privacy:** a public iCloud calendar is not listed anywhere, but anyone with the link can read it, titles and places included.
- **Draft UI copy:**
  - On a computer:
    1. "Go to icloud.com/calendar and sign in."
    1. "Click the info button next to the calendar."
    1. "Turn on Public Calendar, then click Copy."
    1. "Paste the link below."
  - On iPhone or iPad:
    1. "Open Calendar and tap Calendars."
    1. "Tap the info button next to the calendar."
    1. "Turn on Public Calendar, then tap Share Link and Copy."
    1. "Paste the link below."
  - Note: "To stop sharing, turn Public Calendar off."

## Google Calendar

Source: [Google Calendar Help, "Secret address in iCal format"](https://support.google.com/calendar/answer/37648?hl=en).

- **Computer:** "On your computer, open Google Calendar"; in the top right, click **Settings** and then **Settings**; on the left, under **Settings for my calendars**, click the calendar; click **Integrate calendar**; in **Secret address in iCal format**, copy the link.
- **Phone:** Google documents this on a computer only, and the Google Calendar app does not show it; the copy says to use a computer (opening calendar.google.com in a phone browser's desktop view is not documented by Google and is not suggested).
- **Work or school accounts:** "your admin might've changed the sharing settings for your calendar"; if the secret address is missing, ask the admin.
- **What the link looks like:** `https://calendar.google.com/calendar/ical/<calendar id>/private-<token>/basic.ics`, where the calendar id is the email address with `@` written as `%40` for a main calendar, or an id ending `@group.calendar.google.com` for others (third-party examples; Google's page shows no example).
  Google's **public** address has the same shape with `/public/basic.ics` and returns nothing useful unless the calendar is public, so the helper asks for the secret one.
- **Resetting:** Google says "Only you should know the Secret Address for your calendar", and asks you not to share it.
  If it leaks, click **Reset** in the same place to create a new one; the old one stops working.
- **Instead of a link:** a person who uses Google Calendar can also turn on [events from Google Calendar](EVENTS.md#phase-2b-as-built) once it is switched on, which needs no secret link; the Google panel says so when that feature is on.
- **Draft UI copy:**
  - Steps:
    1. "On a computer, open Google Calendar."
    1. "Click Settings, then Settings."
    1. "Under Settings for my calendars, click the calendar."
    1. "Click Integrate calendar."
    1. "Copy the Secret address in iCal format."
    1. "Paste the link below."
  - Note: "Google shows this address on a computer only."
  - Note: "If the link leaks, click Reset in the same place."

## Outlook.com

Sources: [Microsoft Support, share your calendar in Outlook.com](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-com); permission levels and "Reset links" from a third-party guide ([Ablebits, updated 2026-06-09](https://www.ablebits.com/office-addins-blog/make-outlook-calendar-public/)).

- **Computer (Outlook.com or Outlook on the web):** in Calendar, open **Settings**, then **Calendar**, then **Shared calendars**; under **Publish a calendar**, choose the calendar and how much people can see; select **Publish**; copy the **ICS** link (not the HTML one).
- **Detail level:** "Can view when I'm busy" (the default, according to the third-party guide) shows only free and busy times, which gives Solara no titles or places; choose **Can view titles and locations**, the least that works, or "Can view all details".
- **Phone:** Microsoft documents publishing for Outlook.com on the web only; the copy says to use a computer.
- **Work or school accounts (Microsoft 365):** the same steps in Outlook on the web; if **Publish a calendar** is missing, the organisation has turned it off (Microsoft Q&A answers say so; unconfirmed in Microsoft's reference pages).
  The [Outlook connection](OUTLOOK.md) is the alternative there.
- **What the link looks like:** `https://outlook.live.com/owa/calendar/<id>/<token>/cid-<id>/calendar.ics` for personal accounts and `https://outlook.office365.com/owa/calendar/<id>/<token>/calendar.ics` for Microsoft 365 (third-party examples, unconfirmed); the HTML link ends in `calendar.html` instead.
- **Stopping and resetting:** Microsoft: select **Unpublish** under **Publish a calendar**; the third-party guide adds that **Reset links** gives new links and disables the old ones while keeping the calendar published.
- **Draft UI copy:**
  - Steps:
    1. "On a computer, open Outlook.com and go to Calendar."
    1. "Open Settings, then Calendar, then Shared calendars."
    1. "Under Publish a calendar, pick the calendar and Can view titles and locations."
    1. "Click Publish, then copy the ICS link."
    1. "Paste the link below."
  - Note: "Outlook publishes calendars from a computer only."
  - Note: "To change the link, use Reset links or Unpublish there."

## Yahoo Calendar

Sources: Yahoo's own help describes only sharing by email and CalDAV sync ([create, share or delete calendars](https://help.yahoo.com/kb/SLN28064.html), [sync your calendar](https://help.yahoo.com/kb/SLN4707.html)); the link steps come from a third-party guide ([GoDaddy Help](https://www.godaddy.com/help/share-my-yahoo-calendar-24687)) and are unconfirmed.

- **Computer (Yahoo Mail on the web):** open Yahoo Mail, click the Calendar icon, then **Calendar full view**; choose **Actions**, then **Share**; pick the calendar and select **Share**; turn on **Enable my public calendar**, then **Get shareable link**; copy the link under **To import into a Calendar app (ICS)**; click **Save**.
- **Phone:** no documented way; the copy says to use a computer.
- **What the link looks like:** an `https://calendar.yahoo.com/...` address ending in .ics (exact path unconfirmed; the build lane copies a real one from a test account into the tests).
- **Stopping and resetting:** turn **Get shareable link** or **Enable my public calendar** off; whether turning it on again gives a new link is unconfirmed.
- **Draft UI copy:**
  - Steps:
    1. "On a computer, open Yahoo Mail and click Calendar."
    1. "Open Calendar full view, then Actions, then Share."
    1. "Pick the calendar and turn on Enable my public calendar."
    1. "Turn on Get shareable link."
    1. "Copy the link under To import into a Calendar app (ICS)."
    1. "Paste the link below."
  - Note: "To stop sharing, turn the shareable link off."

## Recognising links

`recogniseCalendarLink` first applies the linked calendar URL rules (`normalizeSubscriptionUrl` in `packages/core/src/event-subscriptions.ts`: `webcal://` and `webcals://` become `https://`), then matches the host and path.
A link it does not recognise is still accepted and checked by the server as today; recognition only adds a name and catches common mistakes.

| Provider | Accept as | Catch as a mistake, with the message |
| --- | --- | --- |
| iCloud | host matches `^p\d{1,3}-(caldav\|calendars)\.icloud\.com$` and the path starts with `/published/` | `www.icloud.com/calendar/...` or `icloud.com/...` (the iCloud website or a private invitation): "That is the iCloud website. Turn on Public Calendar and copy its link." |
| Google | host `calendar.google.com`, path `/calendar/ical/<id>/private-<token>/basic.ics` | `/public/basic.ics`: "That is Google's public address. Copy the Secret address in iCal format instead."; `/calendar/embed?src=...` or `/calendar/u/...`: "That is a Google Calendar page. Copy the Secret address in iCal format." |
| Outlook | host `outlook.live.com`, `outlook.office365.com` or `outlook.office.com`, path starting `/owa/calendar/` and ending in .ics | the same path ending in .html: "That is the HTML link. Copy the ICS link instead."; `outlook.live.com/calendar/...` (the Outlook website): "That is the Outlook website. Publish the calendar and copy its ICS link." |
| Yahoo | host `calendar.yahoo.com`, path ending in .ics | any other `yahoo.com` page: "That is a Yahoo page. Copy the link under To import into a Calendar app (ICS)." |

- The checks never fetch anything in the browser (the CSP would not allow it, and the link is a credential).
- Hosts are compared exactly, after lowercasing, never by "contains", so `calendar.google.com.example.net` is not Google.
- Tokens are never logged or shown; the card shows the provider's name and the host, as now.

## Tests

- Unit: every row of the table with made-up tokens, `webcal` and `webcals` forms, upper-case hosts, look-alike hosts, a trailing fragment, and an unrecognised but valid https link (accepted, no name).
- UI harness: the panel for each provider at 390 and 1440 px, light and dark, with 0 axe violations; the recognised-provider hint and one mistake message.
- The copy test: one sentence per step, no em dash, under 120 characters.

## As built

_Built 2026-10-28 by lane LINKGUIDE; switched off with linked calendars (`EVENTS_SUBSCRIPTIONS_ENABLED`)._

- `packages/core/src/calendar-providers.ts` (exported from `@solara/core/event-import`): `recogniseCalendarLink(text)` returns `{ provider, kind, problem }` with `kind` `'calendar'` (the provider's calendar link), `'mistake'` or null, and never any part of the link; `calendarLinkHint` gives the words, `calendarLinkRefused` says whether a mistake stops the link being sent, and `calendarProviderForHost` names a card's provider.
- Rules as in [Recognising links](#recognising-links), with these details:
  - Google's public address is a warning, not a refusal, because a club's public Google calendar does work there: "That is Google's public address, which works only for a public calendar. For your own, copy the Secret address in iCal format."
  - Every other mistake (the iCloud website, a Google Calendar page, Outlook's HTML link or website, a Yahoo page) is refused in the browser with its message, without a request; the button turns to its outline style while such a link is in the field.
  - Paths are matched after the URL parser has resolved them, so dot segments and encoded slashes cannot dress one shape as another; Yahoo pages are any `yahoo.com` host or subdomain (a whole-label match).
- `lib/calendar-guide.ts`: the words, one object per provider, plus the shared notes; `lib/calendar-guide.test.ts` checks each step and note is one sentence under 120 characters without an em dash, and that every provider says how to stop sharing or reset.
- `components/events/AddCalendarGuide.tsx`: loaded by `EventSubscriptions` only when "Add a calendar from..." is opened, so no first load grows (the linked calendars panel is itself loaded only when switched on).
  - The button is a disclosure (`aria-expanded`, `aria-controls`); the providers are native radio buttons in a `radiogroup` named "Where is the calendar?" (arrow keys move and choose); each way's steps are an ordered list named by its heading.
  - Choosing a provider shows its steps, its notes and the two shared notes: the link works like a password (with the tip to use a separate calendar, which also stays under the 1 MB limit), and "Solara checks the link about every 6 hours, so changes can take a few hours to show."
  - Yahoo has no numbered steps, as the open questions required: "On a computer, open the calendar's Share settings in Yahoo Calendar, copy its ICS link and paste it below.", with a note that Yahoo's menus may differ.
  - With events from Google Calendar switched on, the Google choice adds "Or show events from Google Calendar above, with no link."
- Under the link field, a polite live hint names a recognised link ("Looks like a Google Calendar secret address.") or the mistake; the field is described by it.
- A card whose calendar sends no name shows the provider ("Google Calendar", "iCloud", "Outlook", "Yahoo Calendar") with the host beside it (`subscriptionTitle` in `lib/event-subscriptions.ts`), and so does the "Linked ..." message.
- The Function is unchanged: it does not yet add the provider hint to its error messages.
- Tests: `packages/core/src/calendar-providers.test.ts` (every rule, webcal and webcals, upper case, fragments, look-alike and punycode hosts, backslashes, dot segments, credentials, ports, overlong and control-character input, and that no result or hint carries the link), `tests/harness/add-calendar-guide.spec.ts` (each provider at 1440 and 1280 px, 390 and 320 px, light and dark, 0 axe violations; keyboard; recognised and refused links), and `tests/e2e/signed-in/linked-calendars.e2e.ts`, which links a recognised Google secret address through the real `eventSubscriptions` Function on the emulators, with Google's server faked inside the Functions emulator (`tests/e2e/signed-in/emulator-calendars.js`), and checks the link never reaches the page, the console or the stored events.
- Not checked in real accounts: every step the sections above mark unconfirmed, so the [open questions](#open-questions) stay open.

## Open questions

- iCloud: whether turning **Public Calendar** off and on gives a new link, and the current host form (`caldav` against `calendars`), from a real account.
- Google: the exact secret address shape, from a real account.
- Outlook.com: the publish permission names, the default level and **Reset links**, which Microsoft's own page does not list; the ICS link shapes for personal and Microsoft 365 accounts.
- Yahoo: every step, the link shape and how to reset it, since Yahoo's help does not describe shareable links; if the build lane cannot confirm them in a real account, Yahoo ships as "paste the ICS link from Yahoo's Share settings" without numbered steps.
