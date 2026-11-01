// Calendar connections: Google Calendar and Outlook events, and how a refresh went.
import { defineMessages, formatNumber, plural } from '@solara/core/i18n'

export default defineMessages('connections', {
  googleCalendar: 'Google Calendar',
  outlook: 'Outlook',
  disconnect: 'Disconnect',
  removeAccessConfirm: "Remove its events and Solara's access?",
  removeEventsConfirm: 'Remove its events from Solara?',
  keep: 'Keep',
  refresh: 'Refresh',
  chooseCalendars: 'Choose calendars',
  calendarsToShow: 'Calendars to show events from',
  save: 'Save',
  cancel: 'Cancel',
  upcomingCount: (n: number) =>
    ` · ${formatNumber(n)} upcoming ${plural(n, { one: 'event', other: 'events' })}`,
  yourMainCalendar: 'Your main calendar',
  yourMainCalendarLower: 'your main calendar',
  calendarsCount: (n: number) => `${n} calendars`,
  calendarFallback: 'Calendar',
  connecting: 'Connecting…',
  googlePermissionAgain: 'Google Calendar needs your permission again. Press Refresh to continue.',
  googleUnreachable: 'Could not reach Google Calendar. Try again.',
  googleDisconnected: 'Disconnected Google Calendar and removed its events.',
  googleRemovedEvents:
    "Removed the events from Google Calendar. To also end Solara's access, remove Solara at myaccount.google.com/connections.",
  googleHint: (days: number) =>
    `See the UV at events already in your Google Calendar. Solara reads the next ${days} days in this browser, with read-only access, and keeps only events with an address or that match one of your activities. Only an address's town is searched to find the place.`,
  showGoogle: 'Show my Google Calendar events',
  googleEndsAll:
    "Google ends all of Solara's calendar access at once, so Scheduled activities will ask to connect again.",
  upToCalendars: (max: number) => `Show events from up to ${max} calendars.`,
  googleLoadFailed: 'Could not load your Google Calendar settings. Check your connection.',
  readingGoogle: 'Reading your Google Calendar…',
  outlookBusy: 'Outlook is busy. Try again in a few minutes.',
  outlookUnreachable: 'Could not reach Outlook. Try again.',
  microsoftPopupBlocked:
    'Your browser blocked the Microsoft sign-in window. Allow pop-ups for Solara, then try again.',
  microsoftInsecure:
    'Microsoft sign-in needs a secure connection. Open Solara at its https:// address, then try again.',
  adminApproval:
    'Your organization needs to approve Solara before it can read your work calendar. Ask your IT team.',
  adminApprovalLinked:
    'Your organization needs to approve Solara before it can read your work calendar. Ask your IT team, or link the calendar under Linked calendars instead.',
  outlookPermissionAgain: 'Outlook needs your permission again. Press Refresh to continue.',
  outlookNotConnected: 'Outlook was not connected. Try again.',
  outlookDisconnected: 'Disconnected Outlook and removed its events.',
  outlookHint: (days: number) =>
    `See the UV at events already in your Outlook.com or Microsoft 365 calendar. Solara reads the next ${days} days in this browser, with permission to read basic event details only, and keeps only events with an address or a place picked in Outlook, or that match one of your activities. Only an address's town is searched to find the place.`,
  showOutlook: 'Show my Outlook events',
  upToYourCalendars: (max: number) => `Show events from up to ${max} of your calendars.`,
  outlookLoadFailed: 'Could not load your Outlook settings. Check your connection.',
  noTokenStored: 'Solara stored no Microsoft token. To also remove the permission you gave it, use',
  yourMicrosoftAccount: 'your Microsoft account',
  outlookComOr: '(Outlook.com) or',
  myApps: 'My Apps',
  workOrSchool: '(work or school).',
  readingOutlook: 'Reading your Outlook calendar…',
  syncShowing: (shown: string, n: number, service: string) =>
    `Showing ${shown} upcoming ${plural(n, { one: 'event', other: 'events' })} from ${service}.`,
  syncAllDuplicates: (count: string, n: number, service: string) =>
    plural(n, {
      one: `Your ${count} event from ${service} is already in Solara, so it is shown once.`,
      other: `Your ${count} events from ${service} are already in Solara, so they are shown once.`,
    }),
  syncNone: (days: number) =>
    `No events in the next ${days} days have an address or match one of your activities.`,
  syncDuplicates: (count: string, n: number) =>
    plural(n, {
      one: `${count} event already in Solara is shown once.`,
      other: `${count} events already in Solara are shown once.`,
    }),
  syncOverLimit: (count: string, n: number) =>
    `${count} later ${plural(n, { one: 'event', other: 'events' })} will show once sooner ones have passed.`,
  syncRefused: (count: string, n: number, cap: string) =>
    `${count} ${plural(n, { one: 'event', other: 'events' })} did not fit. ${cap}`,
  syncMissing: (calendars: string, n: number) =>
    `${calendars} ${plural(n, { one: 'is', other: 'are' })} no longer shared with you.`,
  notUpdated: 'Not updated yet',
  updatedJustNow: 'Updated just now',
  updatedMinutesAgo: (n: number) =>
    `Updated ${n} ${plural(n, { one: 'minute', other: 'minutes' })} ago`,
  updatedHoursAgo: (n: number) => `Updated ${n} ${plural(n, { one: 'hour', other: 'hours' })} ago`,
  updatedOn: (date: string) => `Updated ${date}`,
})
