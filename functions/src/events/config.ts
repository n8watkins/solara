// Linked calendars and event heads-ups (docs/integrations/EVENTS.md, phase 2): the switch
// that turns them on.

import { defineBoolean } from 'firebase-functions/params'

/**
 * Whether people can link calendars and the scheduled refresh fetches them, and whether
 * the `alerts` Function sends Pro heads-ups before high-UV events. Off until the owner
 * switches it on (the EVENTS_SUBSCRIPTIONS_ENABLED repository variable, which the deploy
 * honours only together with ENABLE_BLAZE_FUNCTIONS); while off, the endpoint answers 404
 * and each scheduled run returns at once. Heads-ups also need ALERTS_ENABLED.
 */
export const EVENTS_SUBSCRIPTIONS_ENABLED = defineBoolean('EVENTS_SUBSCRIPTIONS_ENABLED', {
  default: false,
})
