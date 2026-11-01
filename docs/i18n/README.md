# Languages

Solara speaks English and Latin American Spanish ([ROADMAP item 46](../ROADMAP.md#46-languages-setup-and-the-app-in-spanish-built)).
English is the source of truth; every other language is a translation of it.

## How it works

- Every user-visible string lives in a message namespace: an English module that calls `defineMessages` (`messages/<area>.ts` for the app, `packages/core/src/messages/<area>.ts` for text the Functions share) and one translation per language (`messages/es/<area>.ts`, `packages/core/src/messages/es/<area>.ts`).
- A message is a string or a function of its parameters; plurals go through `plural()`, which uses the language's CLDR rules (`Intl.PluralRules`).
- Each translation is typed against its English module (`satisfies Translation<typeof en>`), so a missing or extra key, or a message with other parameters, fails the typecheck.
- Code reads the English object (`m.title`); switching the language copies the translation's strings into it (`packages/core/src/i18n.ts`), so English needs no lookup and no extra download.
- The language is chosen before first paint by `LANGUAGE_INIT_SCRIPT` (`lib/i18n.ts`): the choice in Settings, Display (kept in this browser and synced to a signed-in account as `language`), else the first supported language in `navigator.languages`, else English.
- Another language downloads only its own translations, in two chunks: `messages/es/initial.ts` (everything the opening screen shows; the app renders once it has arrived, so nothing changes language on screen) and `messages/es/rest.ts` (everything that loads on demand; `components/deferred.tsx` waits for it).
- Text in a page's static HTML (the loading screen, the footer, the consent banner, the pages without JavaScript) is written in every language at once with `components/StaticText.tsx` and `messages/static.ts`; CSS shows the page's language.
- Dates and numbers follow the language through `intlTag()` (the device's own tag for that language, else `en-US` or `es-419`); the 12-hour clock is a message (`9am`, `9 a.m.`).
- The Functions write an account's pushes and calendar feed in its language (`users/{uid}.language`: Spanish for `es`, English otherwise, since `auto` follows a device the server never sees).
  They build each text inside `inAccountLanguage` (`packages/core/src/server-language.ts`), which switches every shared core namespace with `withLocale` for that synchronous piece of work only; the words are in `packages/core/src/messages/server.ts` and the shared core catalogues.

## The static pages

- The landing page, the privacy policy, the terms and the city pages have an address per language (decision "Language pages"): `/`, `/privacy/`, `/terms/`, `/uv/`, `/uv/<city>/` in English and the same under `/es/` in Spanish, each a page of its own in `app/es/`.
- `lib/page-language.ts` gives each page its address in a language (`localePath`), its canonical address and `hreflang` alternates (both languages, English as x-default) and its social cards (`pageMetadata`), and the sitemap lists every page in both languages with the same alternates.
- Every page links to the same page in the other language (`components/LanguageLink.tsx`, named in that language and marked with its `lang`).
- The landing and city pages read their words from `messages/landing.ts`, `messages/city-pages.ts` and `messages/site.ts` and their translations (`messages/es/pages.ts`, built into the HTML, never into the app's chunks); words from the app's catalogues (plan features, UV categories, city facts) are built inside `inPageLanguage`, synchronously, before rendering.
  City, region and country names in another language are in `lib/cities/names.ts`.
- The one root layout writes `<html lang="en">`; at export, `scripts/static-pages.mjs` gives every page under `es/` `<html lang="es">`, so the static text written in every language (`StaticText`, `StaticLink`) shows Spanish there from the first byte, the footer links the Spanish legal pages, and `LANGUAGE_INIT_SCRIPT` leaves these pages alone.
- The privacy policy and terms are legal documents, written whole in each language (`app/es/privacy/page.tsx`, `app/es/terms/page.tsx`), not in message catalogues.
  Each translation says which English version it translates and that the English version prevails; `TRANSLATED_FROM` in `lib/legal.ts` records that version, and `lib/privacy-policy.test.ts` fails when the English text changes until the translation is brought up to date, and when a section, item or paragraph is missing.
- The landing page's phone screenshot shows the app in the page's language (`public/landing/dashboard-<language>-<scheme>.webp`, made by `tests/harness/landing-shots.spec.ts`).

## Adding a language

1. Add its code to `LOCALES` and its default tag to `DEFAULT_TAGS` in `packages/core/src/i18n.ts`, to `LANGUAGE_PREFERENCES` in `packages/core/src/prefs.ts`, to `LANGUAGE_NAMES` in `lib/i18n.ts`, to the language list in `LANGUAGE_INIT_SCRIPT` and to the `language` check in `firestore.rules` (with a rules test).
2. Copy `messages/es/` and `packages/core/src/messages/es/` to the new code and translate every message; the typecheck lists anything missing.
3. Add the language's chunks to `TRANSLATIONS` in `lib/i18n.ts`, its static texts to `messages/static.ts`, and its CSS rule next to the Spanish one in `app/globals.css`.
4. For the server: add its translations of every core namespace to `SERVER_TRANSLATIONS` in `packages/core/src/server-language.ts`.
5. For the static pages: add its address prefix and Open Graph locale to `lib/page-language.ts`, its pages under `app/<code>/` (the legal pages translated whole, with an entry in `TRANSLATED_FROM` and in the review sheet), its city names to `lib/cities/names.ts`, its `<html lang>` rule to `lib/static-pages.mts` and its pages to `STATIC_PAGES`, and its landing screenshots.
6. Keep each translation's `needsReview` list for every message that gives health or safety guidance (burn times, SPF, shade, UV categories, sunscreen amounts), and generate its review sheet like `docs/i18n/es-review.md`.
7. Run `npm test` (`messages/i18n.test.ts` checks that every message exists, prints the same values and that the opening screen's namespaces are in the first chunk) and the Spanish harness specs, adapted (`tests/harness/spanish.spec.ts`, `tests/harness/spanish-pages.spec.ts`).

## Writing new text

- Never write user-visible text into a component: the lint rule `solara/no-literal-ui-text` (`scripts/eslint/no-literal-ui-text.mjs`) fails on text in JSX and in attributes people read or hear.
- Add the English message, then its Spanish translation in the same change; mark safety wording in `needsReview` and run `UPDATE_I18N_REVIEW=1 npx vitest run messages` to refresh the review sheet.
- Read messages when the text is shown, never into a module-level constant, which would keep English after the language switches.
- A namespace a first-load module reads goes into `messages/es/initial.ts`; the test says which.

## Native review

Machine or non-native first drafts are not good enough for health guidance.
`docs/i18n/es-review.md` lists every Spanish message marked for review, with the English and the context, and the Spanish legal pages, which are reviewed whole (by counsel too); the owner's native speaker checks it ([owner to-do](../OWNER_TODO.md)).
UV categories use the WHO and PAHO Spanish terms: Bajo, Moderado, Alto, Muy alto, Extremo.
