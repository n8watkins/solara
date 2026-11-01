// Every Spanish namespace the app loads on demand (LAZY_TRANSLATIONS in lib/i18n.ts), in
// one object, for server code only: the static pages build their words with them
// (lib/page-language.ts). The app itself never imports this file, so each namespace stays
// a chunk of its own there.
import type { Overlay } from '@solara/core/i18n'
import linking from '@solara/core/messages/es/linking'
import skinQuiz from '@solara/core/messages/es/skin-quiz'
import sunscreen from '@solara/core/messages/es/sunscreen'
import account from './account'
import activities from './activities'
import calendar from './calendar'
import connections from './connections'
import editor from './editor'
import events from './events'
import iconSearch from './icon-search'
import linked from './linked'
import pricing from './pricing'
import profiles from './profiles'
import settings from './settings'
import setup from './setup'
import share from './share'

export default {
  account,
  activities,
  calendar,
  connections,
  editor,
  events,
  iconSearch,
  linked,
  linking,
  pricing,
  profiles,
  settings,
  setup,
  share,
  skinQuiz,
  sunscreen,
} satisfies Overlay
