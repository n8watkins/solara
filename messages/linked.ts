// Linked calendars (a calendar's link, kept current on the server) and the helper that
// shows where each provider keeps that link.
import { defineMessages, formatNumber, plural } from '@solara/core/i18n'

export default defineMessages('linked', {
  linkedCalendars: 'Linked calendars',
  pro: 'Pro',
  seePro: 'See Pro',
  addFrom: 'Add a calendar from…',
  calendarLink: 'Calendar link',
  removeConfirm: 'Remove it and its events?',
  remove: 'Remove',
  keep: 'Keep',
  refresh: 'Refresh',
  linkPrivate:
    "The link stays private on Solara's server; only its site is shown here. Removing a calendar removes its events.",
  somethingWrong: 'Something went wrong.',
  linkedUnread: (title: string) => `Linked ${title}, but its events could not be read yet.`,
  linked: (title: string, n: number) =>
    `Linked ${title}: ${n} upcoming ${plural(n, { one: 'event', other: 'events' })}.`,
  countOf: (count: number, cap: number) => `${count} of ${cap}`,
  stoppedRefreshing:
    'Linked calendars are part of Pro, so yours have stopped refreshing. Their events stay until they end, or remove them below.',
  withProPaste: (hours: number) =>
    `With Pro, paste a calendar link, such as a club or race calendar, and Solara keeps its events current, checking every ${hours} hours.`,
  paste: (hours: number) =>
    `Paste a calendar link, such as a club or race calendar, and Solara keeps its events current, checking every ${hours} hours.`,
  pasteHint: (hours: number) =>
    `Paste a calendar link (https:// or webcal://), such as a club or race calendar, and Solara keeps its events current, checking every ${hours} hours.`,
  checkingLink: 'Checking the link…',
  linkCalendar: 'Link calendar',
  capReached: (cap: number) =>
    `You have linked ${cap} calendars, the most an account can keep. Remove one to link another.`,
  loadFailed: 'Could not load your linked calendars. Check your connection.',
  removedNamed: (title: string) => `Removed ${title} and its events.`,
  refreshNamed: (title: string) => `Refresh ${title}`,
  couldNotRead: (title: string) => `${title} could not be read.`,
  refreshed: (title: string) => `Refreshed ${title}.`,
  removeNamed: (title: string) => `Remove ${title}`,
  signInAgain: 'Sign in again to manage linked calendars.',
  fallback: 'Could not reach Solara. Check your connection and try again.',
  upcomingEvents: (n: number) =>
    `${formatNumber(n)} upcoming ${plural(n, { one: 'event', other: 'events' })}`,
  pausedPro: 'Paused: linked calendars are part of Pro. With Pro, refresh to start it again.',
  pausedFailures: (reason: string) =>
    `Paused after a week of failed checks. ${reason} Refresh to try again.`,
  lastCheckFailed: (reason: string) =>
    `The last check failed. ${reason} Solara will try again automatically.`,
  refused: (n: number, max: string) =>
    `${formatNumber(n)} ${plural(n, { one: 'event', other: 'events' })} did not fit: an account keeps at most ${max} events. Remove some to make room.`,
  pasteBelow: 'Paste the link below.',
  onComputer: 'On a computer',
  onPhone: 'On iPhone or iPad',
  icloudLabel: 'Apple iCloud',
  icloudStep1: 'Go to icloud.com/calendar and sign in.',
  icloudStep2: 'Click the info button next to the calendar.',
  icloudStep3: 'Turn on Public Calendar, then click Copy.',
  icloudPhoneStep1: 'Open Calendar and tap Calendars.',
  icloudPhoneStep2: 'Tap the info button next to the calendar.',
  icloudPhoneStep3: 'Turn on Public Calendar, then tap Share Link and Copy.',
  icloudNote1: "Only the calendar's owner can make it public.",
  icloudNote2: 'To stop sharing, turn Public Calendar off.',
  googleLabel: 'Google',
  googleStep1: 'On a computer, open Google Calendar.',
  googleStep2: 'Click Settings, then Settings.',
  googleStep3: 'Under Settings for my calendars, click the calendar.',
  googleStep4: 'Click Integrate calendar.',
  googleStep5: 'Copy the Secret address in iCal format.',
  googleNote1: 'Google shows this address on a computer only.',
  googleNote2: 'With a work or school account, your admin may have turned it off.',
  googleNote3: 'If the link leaks, click Reset in the same place.',
  outlookLabel: 'Outlook.com',
  outlookStep1: 'On a computer, open Outlook.com and go to Calendar.',
  outlookStep2: 'Open Settings, then Calendar, then Shared calendars.',
  outlookStep3: 'Under Publish a calendar, pick the calendar and Can view titles and locations.',
  outlookStep4: 'Click Publish, then copy the ICS link.',
  outlookNote1: 'Outlook publishes calendars from a computer only.',
  outlookNote2: 'To change the link, use Reset links or Unpublish there.',
  yahooLabel: 'Yahoo',
  yahooSummary:
    "On a computer, open the calendar's Share settings in Yahoo Calendar, copy its ICS link and paste it below.",
  yahooNote1: "Yahoo's help does not describe these links, so its menus may differ.",
  yahooNote2: 'To stop sharing, turn the shareable link off.',
  googleEventsNote: 'Or show events from Google Calendar above, with no link.',
  sharedKey:
    'This link works like a password: anyone who has it can read every event on that calendar, so keep it private.',
  sharedSeparate:
    "A separate calendar for outdoor plans shares less and stays under Solara's 1 MB limit.",
  sharedRefresh: (hours: number) =>
    `Solara checks the link about every ${hours} hours, so changes can take a few hours to show.`,
})
