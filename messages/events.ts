// Imported events and their UV: the Events section, its cards and the import summary.
import { defineMessages, plural } from '@solara/core/i18n'

export default defineMessages('events', {
  readingFile: 'Reading the file…',
  couldNotSaveChange: 'Could not save that change. Try again.',
  couldNotRemove: 'Could not remove that. Try again.',
  removingEvents: 'Removing your events…',
  removedAllImported: 'Removed every imported event.',
  couldNotRemoveAll: 'Could not remove every event. Try again.',
  events: 'Events',
  importIcs: 'Import .ics',
  fileToImport: 'Calendar file to import',
  couldNotLoad: 'Could not load your events. Check your connection.',
  noUpcoming:
    'No upcoming events yet. On Meetup, Eventbrite, a race page or your calendar, use “Add to calendar” or “Export” to download an .ics file, then import it here.',
  upcomingEvents: 'Upcoming events',
  removeAllConfirm: 'Remove every imported event?',
  remove: 'Remove',
  keep: 'Keep',
  removeImported: 'Remove imported events',
  refreshNote:
    'Events update while Solara is open: by themselves for an hour after you connect or refresh, otherwise when you press Refresh.',
  seePro: 'See Pro',
  untitled: 'Untitled event',
  couldNotSavePlace: 'Could not save the place. Try again.',
  fromLinked: 'From a linked calendar',
  loadingForecast: 'Loading the forecast…',
  seeItNowPro: 'See it now with Pro',
  setPlace: 'Set the place',
  searchCity: 'Search a city…',
  cancel: 'Cancel',
  countsAs: 'Counts as',
  noActivity: 'No activity (open sun)',
  changePlace: 'Change place',
  eventPage: 'Event page',
  whereIsCalendar: 'Where is the calendar?',
  howToCopy: 'How to copy the link from',
  linkedCalendars: 'linked calendars',
  googleCalendar: 'Google Calendar',
  outlook: 'Outlook',
  placeSetFor: (city: string, n: number) => `Place set to ${city} for ${n} events.`,
  placeSet: (city: string) => `Place set to ${city}.`,
  eventsLead: (sources: string) => `The UV during events you plan to go to, ${sources}.`,
  removedEvent: (title: string) => `Removed ${title}.`,
  theEvent: 'the event',
  showFewer: 'Show fewer',
  showAll: (n: number) => `Show all ${n} events`,
  keptStay: (sources: string) =>
    `Events from ${sources} stay; remove those with their calendar below.`,
  proSendsHeadsUp: (rule: string) =>
    `Pro sends a heads-up ${rule}, to the devices you turned alerts on for. Change it in Settings.`,
  proAddsLinked:
    'Pro adds linked calendars and a heads-up a few hours before an outdoor event with high UV.',
  withProHeadsUp: 'With Pro, get a heads-up a few hours before an outdoor event with high UV.',
  keptDataLinked:
    "Only each event's title, time and place, and the link a calendar file or linked calendar gives, are kept, and only until 30 days after it ends.",
  keptData:
    "Only each event's title, time, place and link are kept, and only until 30 days after it ends.",
  sourceFile: 'a calendar (.ics) file',
  sourceLink: 'a calendar link',
  fromSources: (sources: string) => `from ${sources}`,
  usingPlace: (place: string) => `Using ${place}`,
  fromGoogle: 'From Google Calendar',
  fromOutlook: 'From Outlook',
  couldNotFindPlace: (where: string) =>
    `Solara could not find “${where}”, so this uses your place.`,
  noPlaceUsesYours: 'The event has no place, so this uses your place.',
  noPlaceFound: 'No place found by that name.',
  placeSearchUnavailable: 'Place search is not available.',
  removeNamed: (title: string) => `Remove ${title}`,
  placeFor: (title: string) => `Place for ${title}`,
  eventPageFor: (title: string) => `Event page for ${title}`,
  later: 'Later',
  unknown: 'Unknown',
  fileTooLarge: 'That file is larger than 1 MB. Export a shorter range of events.',
  notCalendarFile:
    'That file is not a calendar (.ics) file. Use "Add to calendar" or "Export" on the event page to get one.',
  fileTooSlow: 'That file took too long to read. Export a shorter range.',
  couldNotRead: 'Could not read that file.',
  findingPlaces: 'Finding the places…',
  findingPlacesOf: (done: number, total: number) => `Finding the places… ${done} of ${total}`,
  saving: 'Saving…',
  couldNotSaveEvents: 'Could not save the events. Try again.',
  skippedAllDay: (n: number) =>
    `${n} ${plural(n, { one: 'all-day event', other: 'all-day events' })}`,
  skippedPast: (n: number) => `${n} ${plural(n, { one: 'past event', other: 'past events' })}`,
  skippedCancelled: (n: number) =>
    `${n} ${plural(n, { one: 'cancelled event', other: 'cancelled events' })}`,
  skippedTooFar: (n: number) =>
    `${n} ${plural(n, { one: 'event', other: 'events' })} more than a year away`,
  skippedTooLong: (n: number) =>
    `${n} ${plural(n, { one: 'event', other: 'events' })} longer than a week`,
  skippedInvalid: (n: number) =>
    `${n} ${plural(n, { one: 'unreadable event', other: 'unreadable events' })}`,
  skippedOverLimit: (n: number, limit: number) => `${n} more past the ${limit}-event limit`,
  skippedTooComplex: (n: number) =>
    `${n} ${plural(n, { one: 'repeating event', other: 'repeating events' })} too complex to read`,
  imported: (n: number) => `Imported ${n} ${plural(n, { one: 'event', other: 'events' })}.`,
  noneImported: 'No events were imported.',
  noneFound: 'No upcoming events with a start time were found in that file.',
  removedStale: (n: number) =>
    `Removed ${n} ${plural(n, { one: 'event', other: 'events' })} cancelled or no longer in the calendar.`,
  refused: (n: number, cap: string) =>
    `${n} ${plural(n, { one: 'event', other: 'events' })} did not fit. ${cap}`,
  skipped: (notes: string) => `Skipped ${notes}.`,
  guessed: (n: number) =>
    `${n} ${plural(n, { one: 'event', other: 'events' })} had no place Solara could find; set it on the event.`,
  forecastFrom: (date: string) => `Forecast from ${date}`,
  noForecastHours: 'No UV forecast for these hours.',
  nearZero: 'UV stays near 0 during the event.',
  peakAt: (uv: string, time: string, average: string) =>
    `Peak UV ${uv} at ${time} · average ${average}`,
  whoGroup: (person: string, skin: string) => `${person} (${skin}, the most sensitive)`,
  burn: (who: string, minutes: number) =>
    `Unprotected, ${who} could burn in about ${minutes} min at the peak.`,
  burnOutlasts: (who: string, minutes: number, duration: string) =>
    `Unprotected, ${who} could burn in about ${minutes} min at the peak; the event lasts ${duration}.`,
  sunscreenReapplyAt: (apply: string, reapply: string) =>
    `Sunscreen: apply ${apply}, reapply at ${reapply}, and after swimming or heavy sweating.`,
  sunscreenApply: (apply: string) =>
    `Sunscreen: apply ${apply}; reapply after swimming or heavy sweating.`,
  headsUpSourceFile: 'a calendar file',
  headsUpSourceLinked: 'a linked calendar',
  headsUpRule: (hours: number, uv: number, sources: string, gap: number) =>
    `about ${hours} hours before an outdoor event (one with an activity set) with UV ${uv} or higher, from ${sources}, at most one every ${gap} hours (it also counts the others coming up)`,
  // Something shared to the installed app (SharedItem, lib/shared-item.ts).
  sharedWithSolara: 'Shared with Solara',
  done: 'Done',
  signInWithGoogle: 'Sign in with Google',
  addThisCalendar: 'Add this calendar',
  notNow: 'Not now',
  close: 'Close',
  readingShared: 'Reading what you shared…',
  nothingToImport:
    'Nothing to import: what was shared has been imported already, or it waited more than 30 minutes. Share it again to import it.',
  readingName: (name: string) => `Reading ${name}…`,
  eventsIn: (name: string) => `Events in ${name}`,
  andMore: (n: number) => `And ${n} more ${plural(n, { one: 'event', other: 'events' })}.`,
  signInToKeep:
    'Sign in to keep them: Solara keeps events with your account. The file waits here for 30 minutes.',
  signInToKeepUnavailable:
    'Sign in to keep them: Solara keeps events with your account. The file waits here for 30 minutes (signing in is not available on this site).',
  tryAgain: 'Try again',
  importCount: (n: number) => `Import ${n} ${plural(n, { one: 'event', other: 'events' })}`,
  linkIsPage: (host: string) =>
    `That is a link to a web page (${host}), not a calendar. On the event's page, use “Add to calendar” or “Export” to download an .ics file, then share the file to Solara.`,
  cannotLinkYet: (host: string) =>
    `Solara cannot link calendars yet. Download the calendar from ${host} as an .ics file and share the file instead.`,
  linkIsBelow: (host: string) =>
    `The calendar link from ${host} is in Linked calendars below, with the steps for its provider. Check it, then press Link calendar.`,
  linkIt: (host: string) =>
    `A calendar link from ${host}. Link it, and Solara keeps its events current.`,
  linkSignIn: (host: string) =>
    `A calendar link from ${host}. Linked calendars keep a calendar's events current and are part of Pro, so sign in first. The link waits here for 30 minutes.`,
  linkPro: (host: string) =>
    `A calendar link from ${host}. Linked calendars, which keep a calendar's events current, are part of Pro.`,
  noneFoundIn: (name: string) => `No upcoming events with a start time were found in ${name}.`,
  hasUpcoming: (name: string, n: number) =>
    `${name} has ${n} upcoming ${plural(n, { one: 'event', other: 'events' })}.`,
  shareTooLarge:
    'That file is larger than 1 MB. Export a shorter range of events, then share it again.',
  shareNotCalendar:
    "Solara can import calendar (.ics) files only. On the event's page, use “Add to calendar” or “Export” to get one, then share that file.",
  shareNothing:
    'Nothing came through with that share. Share a calendar (.ics) file or a calendar link.',
})
