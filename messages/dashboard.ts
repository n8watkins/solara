// The dashboard's opening screen: the day chips, the briefing, the UV card and strip,
// the burn and vitamin D estimates and the activities heading.
import { defineMessages, plural } from '@solara/core/i18n'

export default defineMessages('dashboard', {
  addingToCalendar: 'Adding to your Google Calendar…',
  scheduledOnCalendar: (activity: string, time: string) =>
    `✓ Scheduled ${activity} for ${time}. It is on your Google Calendar.`,
  addToCalendarFailed: 'Could not add to Google Calendar. Nothing was saved; try again.',
  noUvDataTitle: 'No UV data for this period',
  noUvDataBody: (from: string, to: string) => `UV data is available between ${from} and ${to}.`,
  disclaimer:
    'Forecast-based planning estimates, not medical advice. Conditions can change; use sun protection.',

  uvByHour: 'UV by hour',
  uvByHourHelp:
    'Each bar shows the UV index for that hour. Hover or tap to see burn time and conditions.',
  sunIsDown: 'Sun is down',
  beforeSunrise: 'Before sunrise',
  uvReturnsAbout: (when: string) => `UV returns about ${when}`,
  uvValue: (uv: string) => `UV ${uv}`,
  burnAbout: (duration: string) => `burn ~${duration}`,
  rainChance: (percent: number) => `${percent}% rain`,
  headAt: (time: string) => ` at ${time}`,
  headNow: ' now',
  headPeak: ' peak',

  spokenHours: (h: number) => `${h} ${plural(h, { one: 'hour', other: 'hours' })}`,
  spokenMinutes: (m: number) => `${m} ${plural(m, { one: 'minute', other: 'minutes' })}`,
  burnWhoseGroup: (person: string, skin: string) =>
    `${person}'s ${skin}, the most sensitive in your group,`,
  burnWhoGroup: (person: string) => `${person} (most sensitive)`,
  burnTitle: 'Estimated burn time',
  burnHelp: (whose: string) =>
    `A rough estimate for ${whose} without sunscreen at this UV level. Do not use it as a timer for unprotected exposure.`,
  noBurnRisk: 'No burn risk',
  burnNow: (who: string) => `Now · ${who}, no SPF`,
  burnAtPeak: (who: string) => `At peak · ${who}, no SPF`,
  editSkinType: 'Edit skin type',
  edit: 'Edit',
  until: (when: string) => `Until ${when}`,
  // Titles, buttons and headings keep "vitamin D" on one line (a no-break space).
  vitdTitle: 'Vitamin\u00a0D estimate',
  vitdHelp: (dose: string) =>
    `About ${dose} IU of vitamin D for an adult with arms and legs bare: roughly a third of the time it takes the skin to redden (the common rule of thumb, Holick, 2004). A rough model, not a recommended exposure target. Needs and production vary widely and fall with age; ask a clinician if you are concerned.`,
  vitdDose: (dose: string) => `≈${dose} IU · arms\u00a0+\u00a0legs`,
  uvTooLow: 'UV too low',
  needsUv1: 'Needs UV 1 or more',
  vitdLog: 'Vitamin\u00a0D log',
  vitdLogHint: 'Write down time in the sun',

  shareFailed: 'Could not share. Check your connection and try again.',
  sharedBriefing: 'Shared the briefing.',
  copiedBriefing: 'Copied the briefing and link.',
  shareUnsupported: 'Sharing is not supported here.',
  share: 'Share',
  briefingLocked: "Tomorrow's peak UV, best window and burn time come with a free account.",
  signInToPlanTomorrow: 'Sign in free to plan tomorrow',
  atAGlance: (day: string) => `${day} at a glance`,
  atAGlanceShareTitle: (day: string) => `${day} at a glance - Solara`,
  dayIn: (day: string, city: string) => `${day} in ${city}`,

  next10Days: 'Next 10 days',
  refresh: 'Refresh',
  refreshForecast: 'Refresh forecast',
  moreDays: 'More days',
  goPro10Days: 'Go Pro for 10-day planning',
  seeNext10Days: 'See the next 10 days with Pro',

  // The hour chips: read as "UV 6.0, High, at 10am, current hour".
  chipUv: 'UV ',
  chipLevel: (level: string) => `, ${level}, `,
  chipNow: 'Now',
  chipAt: (_time: string) => 'at ',
  chipCurrentHour: ', current hour',
  chipNoData: (_time: string) => 'No UV data at ',
  uvScale: 'UV scale',
  uvForecastByHour: 'UV forecast by hour',
  todaysPeak: "Today's peak",
  peak: 'Peak',
  noData: 'No data',
  moreInfo: 'More info',

  activities: 'Activities',
  activitiesIntro: 'Add what you do outside, then Solara estimates lower-UV windows.',
  addActivity: '+ Add activity',
  manage: 'Manage',
  savePlanTitle: 'Save your plan, sign in free',
  signInFree: 'Sign in free',
  savePlanBody: (activities: number) =>
    `Your plan is kept only on this device. Sign in with Google to keep it on every device, plan up to ${activities} activities and see tomorrow too.`,
  noActivitiesTitle: 'No activities set up yet',
  noActivitiesBody: 'Add your outdoor activities to see forecast-based, lower-UV planning windows.',

  windowsPassedSignIn: 'Sign in free to plan tomorrow.',
  windowsPassedNone: 'No later forecast day has a lower-UV slot for it.',
  windowsPassedNext: (when: string, time: string) => `Next slot: ${when} at ${time}.`,

  forecastErrorLoad:
    "The forecast service isn't answering right now. Solara will try again in a minute.",
  forecastErrorRefresh:
    "The forecast service isn't answering, so this is the last forecast Solara got. It will try again in a minute.",
  accountLoadError:
    'Could not load your saved account. Nothing was changed. Check your connection and try again.',
  accountCreateError:
    'Could not finish setting up your account. Nothing was saved. Check your connection and try again.',
  accountLoadFailed: 'Could not load the account',
  syncNewerVersion:
    'Solara was updated in another tab or device. Reload to keep editing your settings.',
  syncFailed: 'Saved on this device, but cloud sync failed. Retry when your connection returns.',

  checkoutUnreachable: 'Could not confirm your subscription. Check your connection and refresh.',

  eventLinkDetails:
    'Forecast-based lower-UV planning estimate from Solara. Recheck current UV and use sun protection.',

  // The sunscreen timer's idle card, which the first load shows as a placeholder
  // (components/dashboard/ReapplyTimerIdle.tsx).
  sunscreenTimer: 'Sunscreen timer',
  headingOut: (duration: string) => `Heading out? Get a reminder to reapply every ${duration}.`,
  startTimer: 'Start',
  howMuchSunscreen: 'How much sunscreen?',
})
