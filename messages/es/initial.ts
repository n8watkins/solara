// Spanish for the opening screen: the dashboard, the header and everything the first
// load shows. The app waits for this chunk before it renders (lib/i18n.ts), so every
// namespace a first-load module reads belongs here (i18n.test.ts checks it); the rest go
// in ./rest.
import type { Overlay } from '@solara/core/i18n'
import briefing from '@solara/core/messages/es/briefing'
import core from '@solara/core/messages/es/core'
import plans from '@solara/core/messages/es/plans'
import activities from './activities'
import app from './app'
import dashboard from './dashboard'

export default { activities, app, briefing, core, dashboard, plans } satisfies Overlay
