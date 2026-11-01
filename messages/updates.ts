// The notice after a tab left open across a deploy reloaded to the new version
// (lib/stale-build.ts, components/UpdateNotice.tsx). Loaded only with that notice.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('updates', {
  reloaded: 'Solara was updated while this page was open, so it reloaded.',
  reloadedSignIn:
    'Solara was updated while this page was open, so it reloaded. Choose Sign in again to continue.',
})
