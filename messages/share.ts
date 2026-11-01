// A shared plan's page (/share/), which anyone with the link can open.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('share', {
  openSolara: 'Open Solara',
  cannotShow: "This shared link can't be shown",
  cannotShowBody:
    "The link is incomplete, out of date or contains text Solara doesn't display. Ask the sender for a new link, or plan your own lower-UV window in Solara.",
  planYourOwn: 'Plan your own lower-UV window',
  sharedPlan: 'Shared Solara plan',
  pastDay: "This plan was for a day that has passed. Open Solara for today's forecast.",
  recommendedWindow: 'Recommended window',
  peakUv: 'Peak UV',
  disclaimer:
    'This is a forecast-based planning estimate, not medical advice. Recheck current UV and use appropriate sun protection. The activity and place names were written by the person who shared this link.',
})
