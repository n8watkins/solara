// Spanish for everything that loads on demand (components/deferred.tsx), which waits for
// this chunk before it renders.
import type { Overlay } from '@solara/core/i18n'
import linking from '@solara/core/messages/es/linking'
import skinQuiz from '@solara/core/messages/es/skin-quiz'
import sunscreen from '@solara/core/messages/es/sunscreen'
import account from './account'
import calendar from './calendar'
import connections from './connections'
import editor from './editor'
import events from './events'
import linked from './linked'
import pricing from './pricing'
import profiles from './profiles'
import settings from './settings'
import setup from './setup'
import share from './share'

export default {
  account,
  calendar,
  connections,
  editor,
  events,
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
