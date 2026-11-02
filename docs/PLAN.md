# Solara plan

Last updated 2026-11-01, with main at `cf7e4c7` (#165).
This is the plan from here to a promoted free launch, the Pro launch and Android, in order.
It was drafted, then attacked by an adversarial review (21 issues: 1 critical, 6 high, 8 medium, 6 low), and this version includes its corrections.

Steps are split by who does them:

- **Owner (O-steps):** anything that needs your accounts, money, a real phone or a decision only you can make.
  Legal questions wait for an eventual lawyer review; until then Claude uses a recorded best-judgement default for each ([LEGAL_REVIEW.md](LEGAL_REVIEW.md), owner 2026-11-01).
  When a step says "send evidence", a screenshot or the command output is enough; Claude then checks it.
- **Claude (C-steps):** code, tests, docs, pull requests, merges on green CI, and checks from the live site.
  Claude cannot change GitHub variables or secrets, any Google Cloud, Firebase, Stripe, Azure or Play setting, or pay for anything.
  A pull request cannot flip a switch that lives in a GitHub variable; for those, Claude tells you the exact variable and value, and you set it.

The short tickable version of the O-steps stays in [OWNER_TODO.md](OWNER_TODO.md); this file explains the order and the reasons.
Detailed console steps are in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Where things stand

- Live on the free Spark plan at https://solara-uv.web.app, in English and Spanish, for guests and signed-in accounts.
- No Cloud Functions are deployed.
- Built and switched off: Pro billing, the forecast proxy, alerts and pushes, linked calendars, events from Google Calendar and Outlook, the staging deploy.
- Reviews: ten rounds; Review 10 found no critical or high security issues.

## Corrections the adversarial review forced

1. **The budget kill switch is a Cloud Function.**
   `infra/budget.sh` only creates the budget, its message topic and an account; the switch itself is the `budgetAlert` Function, which deploys only with every other Function (`ENABLE_BLAZE_FUNCTIONS`).
   So "Blaze with the kill switch, without Functions" gave budget emails only, which arrive hours late, and no spending limit.
   Fix: step C4 built a deploy of the budget guard on its own (`ENABLE_BUDGET_GUARD`); moving to Blaze now includes switching it on and testing it, in the same sitting (O14).
2. **Free pushes are not a switch before Pro.**
   The alerts job needs the paid Open-Meteo key before it sends the daily UV push, and `ENABLE_BLAZE_FUNCTIONS` deploys every Function with all of their secrets and setup.
   They stay with the Pro launch (Phase 6), tested on staging first.
3. **The name "Solara" may be taken** (an iOS UV and tanning app with vitamin D tracking, and a US sunscreen brand).
   Decide before spending effort tied to the name and domain (O1).
4. **The domain** is tied into API key restrictions, App Check, Google's review and Outlook's redirect, so it must be settled before those steps (O2).
5. **Taxes and auto-renewal law** were missing from the Pro launch (O20).
6. **The vitamin D log** touches health data: it starts on the device only, behind a switch; since a lawyer review is far off (owner, 2026-11-01), it stays on the device for now ([LEGAL_REVIEW.md](LEGAL_REVIEW.md) L6).
7. Several steps had Claude doing things only you can do; they are now O-steps with Claude checking the evidence.

## Phase 0 - Finish Review 10 (Claude, now)

- **C1. Review 10 quality fixes (running).**
  Spanish place search on both paths, burn-time warnings on the card, the recommended slot and the briefing, both flaky tests, a production-like first-load test with real headroom, the vitamin D card's dose wording, and the small issues.
- **C2. Double-check fixes.**
  Daylight saving hour labels, sign-in in a tab left open across a deploy, the Spanish social card, Safari guest storage (ask for persistent storage and correct the landing wording), the dark skin type values, keyboard stops in the hourly strip, and the three Info items.
- **C3. One owner to-do list.**
  `docs/OWNER_TODO.md` stays the only list; the handoff copy becomes a pointer to it.

Exit gate: C1 and C2 merged, the deploys green, and a live check in both languages at 320 px shows the fixes.
Rollback: revert the squash commit; Hosting redeploys main.

## Phase 1 - Name, domain and quiet free launch

Owner, in this order:

- **O0. Install the tools.** Install `gcloud` and the Firebase CLI and sign in to both with the owner account (the scripts in `infra/` need them).
- **O1. Name check.** Search "Solara" in the USPTO and EUIPO trademark registers for apps and health products, and decide: keep the name, or pick a new one.
  Claude can do the rename in the code and copy once you choose.
- **O2. Domain.** Decide whether Solara stays on `solara-uv.web.app` or gets its own domain.
  If a domain: buy it, add it in Firebase Hosting, and tell Claude; Claude updates every place the address appears (C5).
- **O3. Support contact.** Send a test email to the address the app lists, decide who answers it, and tell Claude; Claude adds a contact link in the app.
- **O4. Group 1 of OWNER_TODO:** test sign-in with a non-test account, publish the sign-in app, Sentry, the uptime check, reCAPTCHA and App Check, restrict the browser key and remove `localhost`, Firestore quotas and the alert, the TTL script.
  Send evidence for each (a screenshot or the command output), and a screenshot of the Firestore usage page so Claude can give exact quota numbers.

Claude:

- **C5. Domain change** (only if O2 picks one): canonical addresses, sitemap, social cards, CSP, docs and the checklist values.
- **C6. Check each O4 step from the live site:** a non-test account signs in, a test error reaches Sentry, App Check metrics appear.
- **C7. App Check enforcement:** after 7 days of clean metrics, Claude tells you when to switch enforcement on for Firestore (never Authentication), and checks the site afterwards.

Exit gate: a non-test Google account signs in on the live site; an error reaches Sentry; the uptime alert email arrives in a test; App Check shows verified requests.
Rollback: App Check enforcement can be switched off in the console in one click.

## Phase 2 - Vitamin D log (Claude)

Starts after Phase 0.
Your decisions so far: build the log (2026-11-01); keep the dashboard card and state its dose; no lawyer for now, so the log stays on the device (2026-11-01).

- **C8. Short spec first (built, [ROADMAP item 48](ROADMAP.md#48-vitamin-d-log-vitd-built-on-the-device)),** written into ROADMAP item 48 before code: no goals, streaks or badges; the shared calculation the card uses; sunscreen and uncovered skin modelled; no UV cut-off; age not modelled (stated in the help text).
- **C9. Build, device only, behind a switch (built, item 48; the switch `VITAMIN_D_LOG` is on by default):** sessions by hand and one tap from a finished activity, each with its estimate and how close it came to the burn time, today and 7-day totals, stored in the browser, in English and Spanish, loaded only when opened.
- **C10. Account sync (eventually, not built for now):** synced, rules-checked, in the data download, deleted with the account, pruned after a year, and one privacy line in both languages, once a lawyer has looked at O5.
  Best-judgement default until then: device only, so Solara holds no health data on a server (ROADMAP decision "Vitamin D log sync").

Owner:

- **O5. Lawyer note, eventually** ([LEGAL_REVIEW.md](LEGAL_REVIEW.md) L6): is storing sun-exposure and vitamin D entries on accounts health data where your users live.
  Default until then: the log stays on the device and C10 is not built.

Exit gate: calculation tests, an end-to-end log-and-total test, screenshots in both languages, the first-load limit held.
Rollback: the switch hides the log; device data stays untouched.

## Phase 3 - Security housekeeping (owner, about 1 hour)

Must finish before Phase 5, because `infra/budget.sh` uses the deploy account that keyless deploys set up.

- **O6. Keyless deploys** ([WIF_SETUP.md](WIF_SETUP.md)); send evidence that a deploy ran with it, then delete `FIREBASE_SERVICE_ACCOUNT`.
- **O7. GitHub `production` environment** limited to `main`, with `SENTRY_AUTH_TOKEN` moved into it.
- **O8. Public values from secrets to variables,** and delete the unused `NEXT_PUBLIC_PRO_PRICE` and the duplicate `NEXT_PUBLIC_SITE_URL` secrets.
- **O9. Ruleset and alerts:** require up-to-date branches and the CodeQL checks, turn on private vulnerability reporting, dismiss the listed alerts, and checklist steps A16 and A20.
- **C11. Attach the deploy jobs to the `production` environment** (pull request), after O7.

Exit gate: a deploy from main succeeds with keyless deploys and the environment attached.
Rollback: until the old key is deleted, switching the variables back restores key-based deploys; delete it only after one good keyless deploy.

## Phase 4 - Calendar features (owner setup; Google's review takes days to weeks)

Three separate tracks:

- **4a. Scheduled (Google Calendar adding):** O10 enables the Calendar API and creates the web client (`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`), then O11 requests verification with the justifications and the demo video.
  C12 writes the video script and the justification texts.
- **4b. Events from Google Calendar:** a second, separate verification for `calendar.events.readonly` and `calendar.calendarlist.readonly`, started only after 4a passes (O12).
- **4c. Outlook:** O13 creates the free Azure app registration and sets `MICROSOFT_CLIENT_ID`; independent of Google.
- After each approval, you set the matching `*_ENABLED` variable (Claude gives you the exact name), and C13 checks it on the live site.
- Note: either events switch also turns on Pro heads-ups once `ALERTS_ENABLED` is on.
- If Google rejects: Claude reads the rejection and changes the scopes, copy or video (C14), and you resubmit; Scheduled already works without the events scopes.

## Phase 5 - Before any promotion

- **C4. Budget guard on its own (built, [ROADMAP item 49](ROADMAP.md#49-budget-guard-on-its-own-budgetguard-built)):** the `ENABLE_BUDGET_GUARD` repository variable makes the deploy ship only the `budgetAlert` Function, without the other Functions or their secrets, refusing to run without `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT`; with unit tests of each tier, an emulator run of the guard alone, and `infra/budget-dry-run.sh`, which publishes a test budget message.
- **O14. Blaze:** attach billing, run `infra/budget.sh` (read, then `--apply`), set `BUDGET_ID` and `BUDGET_SERVICE_ACCOUNT`, grant the deploy account the guard's roles, set `ENABLE_BUDGET_GUARD=true` and re-run the Deploy workflow, then run `infra/budget-dry-run.sh` (read, then `--apply`) and send the log lines (checklist C3).
- **C15. Weekly backup:** a script you run (or schedule) that exports Firestore to a storage bucket, with a restore drill in staging later.
- **O15. Spanish review** by a native speaker of `docs/i18n/es-review.md`; required before promoting the Spanish version or shipping new Spanish safety text.
- **O16. Legal review, eventually** ([LEGAL_REVIEW.md](LEGAL_REVIEW.md)): governing law, the Spanish legal text, an EU and UK representative, reCAPTCHA consent in the EU, Mexico's privacy notice, children in family profiles, the vitamin D data (O5) and the rest of that list.
  Default until then (owner, 2026-11-01): no lawyer for now; each item keeps the best-judgement default recorded there, and the terms and app say Solara is not medical advice and who should ask a health professional.
  It becomes urgent item by item, as LEGAL_REVIEW.md says (for example before promoting in the EU, before Pro, before a Play listing).

Exit gate: on Blaze, a test budget message makes the guard act (checked by Claude from the logs you send); a backup exists and restores in a test.
Rollback: detaching billing returns the project to Spark.

## Phase 6 - Staging, then the Pro launch (together, 2 to 3 hours)

- **O17. Staging project** on Blaze with its own budget, the `staging` environment and `STAGING_*` values (checklist B1 and B1a).
- **O18. Stripe in test mode on staging.**
- **C16 with you: every Pro check on staging:** payments, alerts and the free pushes on a real phone (you hold the phone), a restore drill, the kill switch at a tiny budget, a compressed request refused, a reminder on time.
- **O19. Open-Meteo Standard plan,** bought a few days before the first subscriber (checklist C9), not after.
- **O20. Taxes and renewals:** choose Stripe Tax with the registrations it needs, a reseller that handles tax (merchant of record), or no EU and UK sales at first; and have the trial reminder and cancel path checked against California's auto-renewal law ([LEGAL_REVIEW.md](LEGAL_REVIEW.md) L14 and L15: the one lawyer item that must happen before `BILLING_ENABLED`).
- **O21. Production order:** the live Stripe webhook, the four Functions secrets, the first Functions deploy, then `FORECAST_PROXY_ENABLED`, `BILLING_ENABLED`, and the alerts steps (Cloud Tasks, roles, the TTL rerun, region check, `ALERTS_ENABLED`).
- **C17. Final security review** on the release commit, and a check of each switch from the live site as you flip it.

Exit gate: one real purchase and refund in production, one morning alert and one free push received on a real phone.
Rollback: `BILLING_ENABLED=false` hides checkout; Functions keep running after a switch goes off, so the budget guard stays the backstop.

## Phase 7 - Android

- Wave 6 (the Expo app) is your learning project; Claude helps only when you ask.
- **O22. Play listing items** from [integrations/ANDROID.md](integrations/ANDROID.md): the developer account (an organisation account skips the 12 testers for 14 days rule), the data safety form, the health apps declaration, an Android section in the privacy policy, and a real-device check that prices are hidden however the app opens.
- **C18 on request:** the Digital Asset Links file (assetlinks.json), Play Integrity for App Check, native OAuth client notes, or a Trusted Web Activity as a quick first listing.

## Phase 8 - Next features (Claude, after the vitamin D log)

Ranked by value to users; each starts with a short spec and the usual review.

1. Place that follows the phone (offer to switch when far from the saved place; quick switch between saved places): spec in [ROADMAP item 54](ROADMAP.md#54-place-that-follows-the-phone-travel-built), built.
2. Burn-time fit as a feature (how much sunscreen makes a plan fit).
3. Light-sensitivity setting: allowed now (owner, 2026-11-01), designed to store no medical detail: one factor, "I burn more easily than my skin type suggests" (normal, more sensitive, much more sensitive), with help text that names examples (some medicines, pregnancy, recent peels) only as information and never asks which applies ([LEGAL_REVIEW.md](LEGAL_REVIEW.md) L7); built in a later lane.
4. Hat, sunglasses and shade in the advice line.
5. "Better window" for events you control.
6. Air quality and pollen (needs a cost line first).
7. Portuguese (Brazil), when Analytics shows the demand.

The Android widget and Wear OS tiles belong to the Expo app.

## Decisions waiting on you

| Decision | Default until you decide |
| --- | --- |
| Keep the name "Solara" (O1) | Keep; no new name-dependent spending |
| Own domain (O2) | Stay on `solara-uv.web.app` |
| Who answers support email (O3) | The address the app lists today |
| Vitamin D data on accounts (O5) | Device only; no lawyer for now ([LEGAL_REVIEW.md](LEGAL_REVIEW.md) L6) |
| Legal questions (O16) | Best-judgement default per item in [LEGAL_REVIEW.md](LEGAL_REVIEW.md) |
| Tax approach for Pro (O20) | Not decided; Pro does not launch without it |
