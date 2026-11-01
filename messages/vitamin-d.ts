// The vitamin D log (ROADMAP item 48): its dialog, sessions, totals, chart and form. Every
// number is an estimate and says so; nothing here sets a goal or rewards more sun.
import { defineMessages, plural } from '@solara/core/i18n'

export default defineMessages('vitaminD', {
  title: 'Vitamin D log',
  lead: 'Rough estimates of the vitamin D your time in the sun may have made, and how close each session came to a burn.',
  deviceOnly: 'Kept only in this browser and never sent to Solara. Signing out clears it.',

  today: 'Today',
  last7Days: 'Last 7 days',
  estimateLabel: 'estimate',
  aboutIu: (iu: string) => `about ${iu} IU`,
  underFiftyIu: 'under 50 IU',
  noneIu: 'none',
  comparison: (amount: string, olderAmount: string) =>
    `For comparison, a commonly cited daily amount is ${amount} IU (15 mcg) for adults, ${olderAmount} IU over 70 (US National Academies, 2011). That is an intake from food and supplements, not a target for time in the sun.`,

  chartTitle: 'Estimated vitamin D by day, last 7 days',
  chartDay: 'Day',
  chartEstimate: 'Estimate',
  chartSessions: 'Sessions',

  sessions: 'Sessions',
  addSession: 'Add a session',
  empty:
    'No sessions yet. Add one after time in the sun, or use "Log it" on an activity that is done for today.',
  session: 'Time in the sun',
  sessionWhen: (day: string, range: string, length: string) => `${day} · ${range} · ${length}`,
  sessionEstimate: (iu: string) => `About ${iu} IU of vitamin D`,
  sessionEstimateUnder50: 'Under 50 IU of vitamin D',
  sessionEstimateNone: 'No vitamin D counted',
  burnOf: (minutes: string, burn: string) => `${minutes} of a ${burn} burn time`,
  burnLine: (risk: string, detail: string) => `${risk} · ${detail}`,
  burnNone: 'UV too low to burn',
  burnWellUnder: 'Well under your burn time',
  burnClose: 'Close to your burn time',
  burnPast: 'Past your burn time: skin is likely to redden',
  cappedNote: 'Time past the burn time adds no vitamin D.',
  lowUvNote: 'Minutes under UV 1 count toward the burn, not the vitamin D.',
  details: (skin: string, uv: string, sunscreen: string) => `${skin} · UV ${uv} · ${sunscreen}`,
  withSunscreen: 'sunscreen',
  noSunscreen: 'no sunscreen',
  edit: 'Edit',
  delete: 'Delete',
  editNamed: (session: string) => `Edit ${session}`,
  deleteNamed: (session: string) => `Delete ${session}`,
  deleted: 'Session deleted.',
  undo: 'Undo',
  logged: (name: string) =>
    `Logged ${name}. Check the time and the skin in the sun, and edit it if they differ.`,
  alreadyLogged: (name: string) => `${name} is already in today's log.`,
  saveFailed: 'Could not save in this browser. Its storage may be full or blocked.',

  exposure: 'Skin in the sun',
  exposureFaceHands: 'Face and hands',
  exposureFaceArms: 'Face and arms',
  exposureArmsLegs: 'Arms and legs',
  exposureSwimwear: 'Swimwear',
  exposureFaceHandsHint: 'Long sleeves and trousers',
  exposureFaceArmsHint: 'Short sleeves, long trousers',
  exposureArmsLegsHint: 'T-shirt and shorts',
  exposureSwimwearHint: 'Most of the body',

  addTitle: 'Add a session',
  editTitle: 'Edit the session',
  date: 'Date',
  startTime: 'Start time',
  length: 'Length (minutes)',
  sunscreen: 'I wore sunscreen',
  sunscreenHint: 'Keep using it: the burn risk matters more than the vitamin D.',
  uvIndex: 'UV index at the time',
  uvHint:
    'The forecast covers only today. Enter the UV index from a weather report for that time, or your best guess.',
  uvFromForecast: (uv: string) => `UV ${uv} on average, from the forecast`,
  skinTypeNote: (skin: string) => `For ${skin}, from Settings, Sun profile.`,
  preview: 'Estimate',
  save: 'Save session',
  cancel: 'Cancel',
  invalidDate: (from: string) => `Choose a day from ${from} to today.`,
  invalidStart: 'Enter a start time.',
  invalidLength: (max: number) => `Enter a length from 1 to ${max} minutes.`,
  invalidUv: (max: number) => `Enter a UV index from 0 to ${max}.`,

  howTitle: 'How these estimates work',
  howModel:
    'About 1,000 IU of vitamin D for an adult with arms and legs bare in roughly a third of the time it takes the skin to redden (the common rule of thumb, Holick, 2004), the same estimate as the dashboard card. Less skin in the sun makes less: face and hands count a quarter, face and arms half, swimwear double.',
  howLowSun:
    'A low sun counts slowly, and UV under 1 counts none. Skin makes no more vitamin D after about one burn dose, so time past the burn time adds nothing.',
  howSunscreen:
    'Sunscreen counts as dividing the UV by 2.5, as the plans assume for SPF 30+, for the burn and the vitamin D alike. As people usually apply it, it blocks far less than its label says (Neale and others, 2019).',
  howLimits:
    'Age is not taken into account: older skin makes much less vitamin D. Needs and production vary widely with the person, the season and where you live. These are rough estimates, not medical advice; ask a clinician if you are concerned.',

  download: 'Download the log',
  deleteAll: 'Delete all sessions',
  confirmDeleteAll: (count: number) =>
    `Delete all ${count} ${plural(count, { one: 'session', other: 'sessions' })} from this browser? This cannot be undone.`,
  confirmDeleteAllAction: 'Delete all',
  keep: 'Keep them',
  deletedAll: 'Every session was deleted from this browser.',
})
