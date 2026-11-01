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
- The Functions switch the language for one synchronous piece of work with `withLocale` (planned with the server-side text, see the roadmap item).

## Adding a language

1. Add its code to `LOCALES` and its default tag to `DEFAULT_TAGS` in `packages/core/src/i18n.ts`, to `LANGUAGE_PREFERENCES` in `packages/core/src/prefs.ts`, to `LANGUAGE_NAMES` in `lib/i18n.ts`, to the language list in `LANGUAGE_INIT_SCRIPT` and to the `language` check in `firestore.rules` (with a rules test).
2. Copy `messages/es/` and `packages/core/src/messages/es/` to the new code and translate every message; the typecheck lists anything missing.
3. Add the language's chunks to `TRANSLATIONS` in `lib/i18n.ts`, its static texts to `messages/static.ts`, and its CSS rule next to the Spanish one in `app/globals.css`.
4. Keep each translation's `needsReview` list for every message that gives health or safety guidance (burn times, SPF, shade, UV categories, sunscreen amounts), and generate its review sheet like `docs/i18n/es-review.md`.
5. Run `npm test` (`messages/i18n.test.ts` checks that every message exists, prints the same values and that the opening screen's namespaces are in the first chunk) and the Spanish harness spec, adapted (`tests/harness/spanish.spec.ts`).

## Writing new text

- Never write user-visible text into a component: the lint rule `solara/no-literal-ui-text` (`scripts/eslint/no-literal-ui-text.mjs`) fails on text in JSX and in attributes people read or hear.
- Add the English message, then its Spanish translation in the same change; mark safety wording in `needsReview` and run `UPDATE_I18N_REVIEW=1 npx vitest run messages` to refresh the review sheet.
- Read messages when the text is shown, never into a module-level constant, which would keep English after the language switches.
- A namespace a first-load module reads goes into `messages/es/initial.ts`; the test says which.

## Native review

Machine or non-native first drafts are not good enough for health guidance.
`docs/i18n/es-review.md` lists every Spanish message marked for review, with the English and the context; the owner's native speaker checks it ([owner to-do](../OWNER_TODO.md)).
UV categories use the WHO and PAHO Spanish terms: Bajo, Moderado, Alto, Muy alto, Extremo.
