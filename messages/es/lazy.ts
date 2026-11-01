// How a Spanish page fetches each namespace the opening screen does not read, a chunk of
// its own (lib/i18n.ts loadMessages). This file loads only on a page in Spanish, with the
// first part that asks for one, so an English page never downloads these loaders.
import type { LazyTranslations } from '@/lib/i18n'

export default {
  account: () => import('./account'),
  activities: () => import('./activities'),
  calendar: () => import('./calendar'),
  connections: () => import('./connections'),
  editor: () => import('./editor'),
  events: () => import('./events'),
  iconSearch: () => import('./icon-search'),
  linked: () => import('./linked'),
  linking: () => import('@solara/core/messages/es/linking'),
  pricing: () => import('./pricing'),
  profiles: () => import('./profiles'),
  settings: () => import('./settings'),
  setup: () => import('./setup'),
  share: () => import('./share'),
  skinQuiz: () => import('@solara/core/messages/es/skin-quiz'),
  sunscreen: () => import('@solara/core/messages/es/sunscreen'),
  updates: () => import('./updates'),
} satisfies LazyTranslations
