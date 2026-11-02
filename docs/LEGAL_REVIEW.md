# Legal review: what a lawyer should eventually look at

> **Not legal advice.**
> This list was written by the people building Solara, not by a lawyer.
> It names the questions a qualified lawyer (and, for taxes, an accountant) should answer, the risk of each in plain words, and the best-judgement default Solara uses until then.
> Where it says a law "may" apply, that is a guess to check, not a conclusion.

Owner decision (2026-11-01): a lawyer review will not happen for a long while, so Solara uses best judgement now and keeps this list.
Each default below is recorded in the [ROADMAP decisions](ROADMAP.md#decisions) as "Owner 2026-11-01: no lawyer for now; best-judgement default, see LEGAL_REVIEW.md".
When a lawyer is hired, give them this page, the [terms](../app/terms/page.tsx), the [privacy policy](../app/privacy/page.tsx), their Spanish translations (`app/es/terms/page.tsx`, `app/es/privacy/page.tsx`) and [PLAN.md](PLAN.md).
The owner's to-do list keeps a single line for all of this ([OWNER_TODO.md](OWNER_TODO.md)).

Sources gathered: [PLAN.md](PLAN.md) (O1, O5, O16, O20, O22), [OWNER_TODO.md](OWNER_TODO.md), the [ROADMAP decisions](ROADMAP.md#decisions), the plan review (`handoff/plan-review.md` in the owner's handoff folder, findings 3, 5, 6, 14, 17 and 20), the review reports in that folder (Review 8 plan item A13, Review 8 QA, Review 10 security), [integrations/ANDROID.md](integrations/ANDROID.md), and the privacy policy and terms as published.

## The qualifier Solara shows now

The terms have a "Not medical advice" section, and the app shows the same sentence wherever health estimates appear (the dashboard footer, setup's skin type step, the sunscreen guide, the vitamin D log, Settings' skin type help, and the landing and city page footers), in English and Spanish:

- English: "If you have a medical condition, take a medicine that makes you more sensitive to the sun, are pregnant, or are worried about your skin or vitamin D, ask a health professional."
- Spanish: "Si tienes un problema de salud, tomas un medicamento que te hace más sensible al sol, estás embarazada o te preocupa tu piel o tu vitamina D, consulta a un profesional de la salud."

It follows a short line that names the context ("Estimates for planning and tracking, not medical advice."), and the terms add that Solara does not guarantee that following its estimates prevents sunburn, skin damage, heat illness or other harm.
The sentence lives once in the app's catalogue (`healthQualifier` in `messages/app.ts`), and `messages/health-qualifier.test.ts` keeps the static pages' copy word for word the same.

## At a glance

| # | Item | Default now | Urgent before |
| --- | --- | --- | --- |
| L1 | Health and medical disclaimer | "Not medical advice" in the terms and the app | Any promotion |
| L2 | Wellness app, not a medical device | No diagnosis, treatment or safety claims; no goals or streaks | Any promotion; any new health feature |
| L3 | The name "Solara" | Keep the name; no new name-dependent spending | Any promotion, a domain, a Play listing |
| L4 | Governing law, warranty and liability limits | California law, with non-waivable local rights kept | Any promotion; Pro |
| L5 | Which language of the legal pages counts | The English version prevails | Promoting the Spanish version |
| L6 | Vitamin D log on accounts | Device only, never sent to Solara | Building account sync (PLAN C10) |
| L7 | Light-sensitivity setting | One factor, no medical detail stored | Building it (Phase 8 item 3) |
| L8 | Skin types and family profiles | Synced with the plan; not directed to children under 13 | Any promotion |
| L9 | EU and UK representative | None appointed | Promotion in the EU or UK |
| L10 | reCAPTCHA (App Check) before consent in the EU | Runs after sign-in only, until the forecast proxy is on | Turning on App Check; the forecast proxy in the EU |
| L11 | International transfers | Providers' standard contractual clauses | Promotion in the EU or UK |
| L12 | Mexico's privacy notice | The general privacy policy in Spanish | Promoting the Spanish version in Mexico |
| L13 | US state privacy and health data laws | Device-only health data; rights honoured for everyone | Account sync of any health data; growth past state thresholds |
| L14 | Auto-renewal and cancellation | Pro does not launch until checked | Pro (`BILLING_ENABLED`) |
| L15 | Taxes on subscriptions | Not decided; Pro does not launch without it | Pro (`BILLING_ENABLED`) |
| L16 | EU withdrawal right and refunds | Not written | Pro sold in the EU or UK |
| L17 | Free-trial records kept after deletion | Keyed hashes kept 2 years | Pro |
| L18 | Play listing: health declaration, data safety, payments | Store build hides prices; forms not filed | A Play listing |
| L19 | Google and Microsoft data terms | Policy follows Google's Limited Use wording | Google's scope verification; Outlook publisher verification |
| L20 | Data licenses and attribution | CC BY 4.0 and ODbL credits on every page that uses the data | Any promotion |
| L21 | Source code license | "All rights reserved" in a public repository | Accepting outside contributions |
| L22 | Accessibility | Fix issues as found; no statement published | Promotion in the EU; any complaint |

## Before any promotion

### L1. Health and medical disclaimer

- **What it is:** Solara shows burn times, sunscreen amounts and SPF advice, vitamin D estimates and "lower-UV" windows.
- **Risk in plain words:** someone relies on an estimate, burns or is harmed, and says Solara told them it was safe; or a regulator or court finds the disclaimer too weak or too hidden.
  People on sun-sensitizing medicines, pregnant people and people with skin conditions are the most likely to be hurt by a generic estimate.
- **Default now:** the terms' "Not medical advice" section (estimates for planning and tracking, not a diagnosis or treatment; who should ask a health professional; no guarantee against sunburn, skin damage or heat illness), the same qualifier in the app wherever health estimates appear, every number labelled an estimate with its source, protection advice judged on the clear-sky UV, and no wording that makes more sun look better (ROADMAP item 48's "Never" rules).
- **Ask the lawyer:** is the disclaimer clear and prominent enough, does it need an explicit acceptance at setup, and does the warranty and liability section hold for health-related estimates in California, the EU and Mexico.
- **Urgent before:** any promotion.

### L2. Wellness app, not a medical device

- **What it is:** health-related software can be regulated as a medical device (the US FDA, the EU Medical Device Regulation) if it diagnoses, treats or prevents a condition.
- **Risk in plain words:** a feature that reads as diagnosis (for example "you are vitamin D deficient") or as a dose prescription could move Solara from general wellness into medical device rules; health claims in marketing can also draw the US FTC's attention.
- **Default now:** Solara stays a general wellness and planning tool: it never diagnoses, never sets vitamin D or exposure goals, never tells someone how many more minutes they can stay out, and compares vitamin D only with a published intake figure for food and supplements, "not a target for the sun".
  Marketing copy says "planning" and "estimates", never "safe" or "prevents".
- **Ask the lawyer:** confirm the wellness position for the vitamin D log and the sunscreen guidance, and what wording a future feature must avoid.
- **Urgent before:** any promotion, and before any new health feature (the light-sensitivity setting, L7).

### L3. The name "Solara"

- **What it is:** an iOS UV and tanning app with vitamin D tracking and a US sunscreen brand already use the name (PLAN correction 3, O1).
- **Risk in plain words:** a trademark owner asks Solara to stop using the name after money and reputation are tied to it, forcing a rename, a new domain and new store listings.
- **Default now:** keep the name, spend nothing more that depends on it (no domain, no paid branding) until the owner's own USPTO and EUIPO search (classes 9, 42, 44, and 3 for the sunscreen brand) and a keep-or-rename decision.
- **Ask the lawyer:** whether the existing marks block an app in these classes, and whether to file Solara's own.
- **Urgent before:** any promotion, buying a domain, Google's branding review and a Play listing.

### L4. Governing law, warranty and liability limits

- **What it is:** the terms choose California law, disclaim warranties and limit liability "to the maximum extent permitted by law", keeping rights the user's own law does not let them waive (PLAN O16, OWNER_CHECKLIST A21).
- **Risk in plain words:** consumer law in the EU, the UK and Mexico often overrides a foreign choice of law and some liability limits, so parts of the terms may not hold where users live; a clause that is plainly unenforceable can also look unfair to a regulator.
- **Default now:** California law with the non-waivable-rights carve-out and the "some jurisdictions do not allow" sentence, in both languages.
- **Ask the lawyer:** the wording of each clause, whether to add a dispute or venue clause, and how it reads for EU and Mexican consumers.
- **Urgent before:** any promotion, and at the latest before Pro, when money changes hands.

### L5. Which language of the legal pages counts

- **What it is:** the Spanish privacy policy and terms are full translations that say the English version prevails (ROADMAP decision "Spanish legal text").
- **Risk in plain words:** some Spanish-speaking countries (and EU consumer law for Spain) may require the version in the user's language to bind, or treat an "English prevails" clause as unfair to a consumer who cannot read English.
- **Default now:** English prevails, stated on each Spanish page; every change to the English text re-dates it and `lib/privacy-policy.test.ts` fails until the translation matches (`TRANSLATED_FROM` in `lib/legal.ts`); a native speaker reviews the Spanish ([es-review.md](i18n/es-review.md)).
- **Ask the lawyer:** whether the prevailing-language clause holds in Mexico, Spain and the US, and review the Spanish pages with the English.
- **Urgent before:** promoting the Spanish version.

### L8. Skin types and family profiles

- **What it is:** a signed-in account syncs its skin type (a Fitzpatrick type) and, on Pro, family profiles with each person's skin type, which can include children entered by a parent.
  The privacy policy says Solara is not directed to children under 13.
- **Risk in plain words:** a skin type could be read as health or physical-characteristic data, and a child's profile as a child's personal data, which some laws (COPPA in the US, GDPR's rules on children) treat more strictly.
- **Default now:** skin type syncs with the plan, as it is needed to give any estimate; family profiles hold only a name the parent chooses and a skin type; no child signs in or has an account.
- **Ask the lawyer:** whether skin type counts as health data anywhere Solara is used, and one line on children in family profiles (plan review finding 20).
- **Urgent before:** any promotion; at the latest before Pro, which adds family profiles.

## Before promotion in the EU or UK

### L9. EU and UK representative

- **What it is:** GDPR Article 27 and UK GDPR ask a controller outside the EU or UK that offers services to people there to name a representative, unless its processing is occasional and low risk.
- **Risk in plain words:** a regulator could fine Solara for not naming one once it targets EU or UK users (a Spanish-language app with synced accounts may not count as "occasional", a guess).
- **Default now:** none appointed; Solara is not promoted in the EU or UK.
- **Ask the lawyer:** whether Solara needs one, and whether a low-cost representative service is enough.
- **Urgent before:** any promotion aimed at the EU or UK, or Pro sales there.

### L10. reCAPTCHA (App Check) before consent in the EU

- **What it is:** App Check uses reCAPTCHA v3, which sends device data to Google; some EU regulators treat that as needing consent under the ePrivacy rules (plan review finding 14).
- **Risk in plain words:** running it before consent could be unlawful for EU visitors.
- **Default now:** reCAPTCHA runs only after sign-in today, and the privacy policy says it will also run without an account once the forecast proxy is on (`recaptchaScope` in `lib/privacy-retention.ts`); App Check is not switched on yet (owner step).
- **Ask the lawyer:** whether sign-in counts as the needed consent, and whether the forecast proxy must wait for consent in the EU.
- **Urgent before:** turning on App Check, and before the forecast proxy serves EU visitors.

### L11. International transfers

- **What it is:** Firebase, Sentry, Stripe and the other providers process data in the United States.
- **Risk in plain words:** EU and UK law allow transfers only with safeguards; a policy that names the wrong mechanism is a compliance gap.
- **Default now:** the privacy policy says transfers rely on the providers' standard contractual clauses or equivalent safeguards, and every provider is named.
- **Ask the lawyer:** whether the providers' own terms (including the EU-US Data Privacy Framework where they are certified) cover Solara, and whether any data processing agreement must be accepted in a console.
- **Urgent before:** promotion in the EU or UK.

### L22. Accessibility

- **What it is:** the EU Accessibility Act applies to some consumer services from 2025, with a microenterprise exemption; US ADA website claims are a nuisance risk.
- **Risk in plain words:** a complaint or demand letter about accessibility.
- **Default now:** the harness runs axe on every screen with zero violations, and visible issues are fixed as found; no accessibility statement is published.
- **Ask the lawyer:** whether the exemption applies and whether to publish a short statement.
- **Urgent before:** promotion in the EU, or on any complaint.

## Before health data reaches accounts

### L6. Vitamin D log on accounts (PLAN O5, C10)

- **What it is:** the vitamin D log records time in the sun with each session's estimated vitamin D and burn risk.
  It is kept only in the browser today and never sent to Solara.
- **Risk in plain words:** a per-day log of sun exposure and vitamin D tied to an account is arguably health data.
  Under GDPR it may be special-category data needing explicit consent (Article 9); Washington's My Health My Data Act (and similar laws in Nevada and Connecticut) covers "consumer health data" broadly, needs separate consent and its own policy, and lets people sue; Mexico's 2025 law treats health data as sensitive (each a guess on applicability).
  Holding it on a server also raises breach and access-request stakes.
- **Default now:** device only, for now.
  Syncing to accounts (PLAN C10) is not built; the log stays in `localStorage`, in the data download as "on this device", deleted with the account, and hidden after a sign-out.
  This avoids holding health data on a server at all, which sidesteps the consent and policy questions above while keeping the feature useful on one device.
- **Ask the lawyer:** whether account sync needs explicit consent, a separate health data policy (Washington), or a data protection impact assessment, and the wording of the one privacy line it would add.
- **Urgent before:** building account sync (PLAN C10); until then, no action.

### L7. Light-sensitivity setting (Phase 8 item 3)

- **What it is:** a planned setting for people who burn more easily than their skin type suggests.
- **Risk in plain words:** asking which medicine someone takes, or whether they are pregnant, would collect special-category health data and could read as medical advice.
- **Default now (design rule, owner 2026-11-01):** allowed, built in a later lane, and designed to store no medical detail.
  It is one factor, "I burn more easily than my skin type suggests" (normal, more sensitive, much more sensitive), that shortens burn times; its help text names examples (some medicines, pregnancy, recent skin peels) only as information and never asks which applies, and it repeats the qualifier.
  The stored value is the factor alone, never a reason, so it syncs with the plan like the skin type.
- **Ask the lawyer:** confirm that a factor with no reason is not health data where Solara is used, or whether it should stay on the device like the vitamin D log.
- **Urgent before:** building it; the design rule holds until a lawyer says otherwise.

### L13. US state privacy and health data laws

- **What it is:** California's CCPA and other state laws give rights and duties once a business passes revenue or user thresholds; Washington's My Health My Data Act has no threshold.
- **Risk in plain words:** missing a duty (a notice, an opt-out, a response time) once Solara grows or once it holds health data on a server.
- **Default now:** Solara does not sell data or use it for advertising; export and deletion are available to everyone; requests by email are honoured only after the person replies from the account's own address (RUNBOOK, `infra/account-request.mjs`); health data stays on the device (L6).
- **Ask the lawyer:** which state laws apply at Solara's size, and whether the privacy policy needs a state-specific section.
- **Urgent before:** any health data on accounts, and when users or revenue approach a state's threshold.

## Before Pro

### L14. Auto-renewal and cancellation (PLAN O20)

- **What it is:** Pro is a subscription with a 7-day free trial.
  California's automatic renewal law (amended for 2025) requires clear renewal terms before checkout, consent to them, a reminder before a free trial converts, and simple online cancellation; other states and the EU have similar rules.
- **Risk in plain words:** fines, refunds or lawsuits if checkout, the trial reminder or the cancel path fall short; the terms today only say renewal terms "are shown before checkout".
- **Default now:** Pro is built and switched off; it does not launch until the checkout copy, the trial reminder and the cancel path are checked.
- **Ask the lawyer:** review the checkout screen, the trial reminder email (Stripe can send it), the cancel path and the terms' subscription section.
- **Urgent before:** `BILLING_ENABLED`.

### L15. Taxes on subscriptions (PLAN O20)

- **What it is:** EU and UK VAT are due from the first sale to a consumer there; some US states tax digital subscriptions.
- **Risk in plain words:** owing tax that was never collected, with penalties.
- **Default now:** not decided; the options are Stripe Tax with the registrations it needs, a reseller that handles tax (merchant of record), or no EU and UK sales at first; Pro does not launch without a choice.
- **Ask an accountant (and the lawyer for the contract side):** which option, and the registrations it needs.
- **Urgent before:** `BILLING_ENABLED`.

### L16. EU withdrawal right and refunds

- **What it is:** EU and UK consumers have a 14-day right to withdraw from online purchases, which for digital services is lost only with their express request and acknowledgement at checkout.
- **Risk in plain words:** refund obligations, or the right extended, if checkout does not capture the acknowledgement.
- **Default now:** not written; tied to the tax choice (L15), since not selling in the EU and UK at first avoids it.
- **Ask the lawyer:** the checkout wording and refund policy if Pro is sold there.
- **Urgent before:** Pro sales in the EU or UK.

### L17. Free-trial records kept after deletion

- **What it is:** to stop repeated free trials, Solara keeps keyed hashes of the sign-in id, the verified email and the card fingerprint for 2 years after a trial, also after the account is deleted (ROADMAP decision "Trial reuse").
- **Risk in plain words:** keeping anything after a deletion request needs a lawful reason and a clear notice, or it breaks the right to erasure.
- **Default now:** keyed hashes only (never the raw values), kept on the "legitimate interests" basis, named in the privacy policy.
- **Ask the lawyer:** confirm the basis and the 2-year period.
- **Urgent before:** Pro.

## Before a Play listing

### L18. Play listing: health declaration, data safety and payments (PLAN O22)

- **What it is:** Google Play asks for a health apps declaration (which may apply to a skin-type and sun-exposure app), a data safety form, a privacy policy section for the Android app, and compliance with its payments policy.
- **Risk in plain words:** a rejected or removed listing, or a policy strike, if the forms or the payments flow are wrong.
- **Default now:** Pro is sold on the web only; the store build hides every price, upsell and checkout (`lib/store-build.ts`), and the app only unlocks what was bought elsewhere; the forms are not filed yet.
- **Ask the lawyer:** whether the "sold on the web, unlocked in the app" model fits Play's current payments policy where Solara is listed, and the Android privacy section.
- **Urgent before:** a Play listing.

## Low, any time

### L12. Mexico's privacy notice

- **What it is:** Mexico's 2025 data protection law expects a privacy notice ("aviso de privacidad") with set contents, in Spanish.
- **Risk in plain words:** a gap for Mexican users once the Spanish version is promoted there.
- **Default now:** the full Spanish privacy policy, which covers what is collected, why, the providers, retention and rights.
- **Ask the lawyer:** whether it meets the notice's required contents.
- **Urgent before:** promoting the Spanish version in Mexico.

### L19. Google and Microsoft data terms

- **What it is:** Google's API Services User Data Policy (Limited Use) and Microsoft's platform terms govern calendar data.
- **Risk in plain words:** a failed verification or a revoked client if the policy wording or the data use drifts from what was approved.
- **Default now:** the privacy policy's Google and Microsoft sections follow Limited Use word for word, tokens stay in memory, and the scopes are the narrowest that work.
- **Ask the lawyer:** only if Google or Microsoft rejects a review on policy grounds.
- **Urgent before:** Google's scope verification and Outlook publisher verification (owner steps).

### L20. Data licenses and attribution

- **What it is:** forecasts and place search use Open-Meteo and GeoNames (CC BY 4.0), city pages use Copernicus (CAMS) data served by Open-Meteo, and device place names come from OpenStreetMap (ODbL).
  The Open-Meteo free tier is for non-commercial use; Pro needs its commercial plan (ROADMAP decision D5).
- **Risk in plain words:** a license breach if the credit is missing or the free tier is used commercially.
- **Default now:** credits on every page that uses the data and in the terms; the commercial plan is bought before billing goes on.
- **Ask the lawyer:** only if a provider raises it.
- **Urgent before:** Pro (the commercial plan).

### L21. Source code license

- **What it is:** the repository is public, but the code is "All rights reserved" (D8).
- **Risk in plain words:** confusion about what others may do with the code, and unclear ownership of outside contributions.
- **Default now:** all rights reserved; no outside contributions are accepted.
- **Ask the lawyer:** only before accepting contributions (a contributor agreement) or changing the license.
- **Urgent before:** accepting outside contributions.
