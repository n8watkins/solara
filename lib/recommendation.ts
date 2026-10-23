// The recommendation engine lives in @solara/core, shared with Cloud Functions.
// These aliases keep the web app's established names.
export {
  SKIN_BURN_BASE,
  effectiveMaxUV,
  burnMins,
  weekdayForDate,
  runsOn as activityRunsOnDate,
  findWindows as findRecommendationWindows,
  bestWindow as bestRecommendationWindow,
} from '@solara/core'
