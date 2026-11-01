// Linking calendars by URL (event-subscriptions.ts, calendar-providers.ts): why a link
// could not be linked, and what a pasted link looks like.
import { defineMessages } from '../i18n'

export default defineMessages('linking', {
  errInvalidUrl: 'That is not a calendar link. Copy the full https:// or webcal:// address.',
  errNotHttps: 'Only https:// and webcal:// calendar links can be linked.',
  errCredentials: 'Links with a user name or password cannot be linked.',
  errPort: 'Only calendar links on the standard https port can be linked.',
  errBlocked: 'That link points to a private or local network address.',
  errUnreachable: 'The calendar site could not be reached.',
  errTimeout: 'The calendar site took too long to answer.',
  errTooLarge: 'That calendar is larger than 1 MB. Link a shorter calendar.',
  errRedirects: 'That link redirects too many times.',
  errHttpStatus: 'The calendar site refused the request. Check the link still works.',
  errNotCalendar: 'That link does not lead to a calendar (.ics) file.',
  errNoPlace: 'Set your place in Solara first, so events without one can use it.',
  errDuplicate: 'That calendar is already linked.',
  errProRequired: 'Linked calendars are part of Pro.',
  errTooMany: (max: number) =>
    `An account can link up to ${max} calendars. Remove one to add another.`,
  errUnknown: 'The calendar could not be read.',
  probIcloudWebsite: 'That is the iCloud website. Turn on Public Calendar and copy its link.',
  probGooglePublic:
    "That is Google's public address, which works only for a public calendar. For your own, copy the Secret address in iCal format.",
  probGooglePage: 'That is a Google Calendar page. Copy the Secret address in iCal format.',
  probOutlookHtml: 'That is the HTML link. Copy the ICS link instead.',
  probOutlookWebsite: 'That is the Outlook website. Publish the calendar and copy its ICS link.',
  probYahooPage: 'That is a Yahoo page. Copy the link under To import into a Calendar app (ICS).',
  probIcloudUnusual:
    'This is not the usual iCloud calendar link. If linking fails, turn on Public Calendar and copy its link.',
  probGoogleUnusual:
    'This is not the usual Google Calendar secret address. If linking fails, copy the Secret address in iCal format.',
  probOutlookUnusual:
    'This is not the usual published Outlook calendar link. If linking fails, publish the calendar and copy its ICS link.',
  probYahooUnusual:
    'This is not the usual Yahoo Calendar link. If linking fails, copy the link under To import into a Calendar app (ICS).',
  providerIcloud: 'iCloud',
  providerGoogle: 'Google Calendar',
  providerOutlook: 'Outlook',
  providerYahoo: 'Yahoo Calendar',
  feedIcloud: 'a public iCloud calendar link',
  feedGoogle: 'a Google Calendar secret address',
  feedOutlook: 'a published Outlook calendar (ICS link)',
  feedYahoo: 'a Yahoo Calendar ICS link',
  looksLike: (what: string) => `Looks like ${what}.`,
})
