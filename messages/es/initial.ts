// Spanish for the opening screen: the dashboard, the header and everything the first
// load shows. The app waits for this chunk before it renders (lib/i18n.ts), so every
// namespace a first-load module reads belongs here (i18n.test.ts checks it); every other
// namespace is a chunk of its own (LAZY_TRANSLATIONS in lib/i18n.ts).
import type { Overlay } from '@solara/core/i18n'
import briefing from '@solara/core/messages/es/briefing'
import core from '@solara/core/messages/es/core'
import plans from '@solara/core/messages/es/plans'
import app from './app'
import dashboard from './dashboard'

export default { app, briefing, core, dashboard, plans } satisfies Overlay
