// The frame of the static pages in every language (ROADMAP item 46, decision "Language
// pages"): the landing page, the privacy policy and terms, and the city pages, each at its
// own address per language (lib/page-language.ts). Built into the pages' HTML; never part
// of the app's chunks.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('site', {
  signIn: 'Sign in',
  openSolara: 'Open Solara',
  backToSolara: '← Back to Solara',
  lastUpdated: (date: string) => `Last updated ${date}`,
  /** The link to the same page in the other language, named in that language. */
  otherLanguage: 'Español',
  /** Its accessible name, in that language too. */
  otherLanguageLabel: 'Leer esta página en español',
  /** Social cards' image description. */
  ogImageAlt: 'Solara lower-UV activity planner',
  /** Ends with app.healthQualifier, word for word (messages/health-qualifier.test.ts). */
  disclaimer:
    'Solara is for planning and tracking, not medical advice, and cannot guarantee that time in the sun is safe. If you have a medical condition, take a medicine that makes you more sensitive to the sun, are pregnant, or are worried about your skin or vitamin D, ask a health professional.',
})
