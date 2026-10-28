// The words of "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md, ROADMAP item
// 24): one object per provider, so the wording can change without touching the panel
// (components/events/AddCalendarGuide.tsx). Every step is one short sentence
// (lib/calendar-guide.test.ts checks it). Steps follow the providers' own help pages as
// cited in the document; Yahoo's are unconfirmed there, so Yahoo has no numbered steps.
import { EVENT_SUBSCRIPTION_LIMITS, type CalendarProvider } from '@solara/core/event-import'

export interface CalendarGuideSteps {
  /** "On a computer", or null when there is only one way. */
  title: string | null
  steps: readonly string[]
}

export interface CalendarGuide {
  /** The choice's label. */
  label: string
  /** Numbered steps, one list per way (computer, phone) where they differ. */
  ways: readonly CalendarGuideSteps[]
  /** Instead of steps, one sentence, when the steps could not be confirmed. */
  summary: string | null
  /** Provider notes: where it works, how to stop sharing or reset the link. */
  notes: readonly string[]
}

const PASTE = 'Paste the link below.'

export const CALENDAR_GUIDES: Readonly<Record<CalendarProvider, CalendarGuide>> = Object.freeze({
  icloud: {
    label: 'Apple iCloud',
    ways: [
      {
        title: 'On a computer',
        steps: [
          'Go to icloud.com/calendar and sign in.',
          'Click the info button next to the calendar.',
          'Turn on Public Calendar, then click Copy.',
          PASTE,
        ],
      },
      {
        title: 'On iPhone or iPad',
        steps: [
          'Open Calendar and tap Calendars.',
          'Tap the info button next to the calendar.',
          'Turn on Public Calendar, then tap Share Link and Copy.',
          PASTE,
        ],
      },
    ],
    summary: null,
    notes: [
      'Only the calendar’s owner can make it public.',
      'To stop sharing, turn Public Calendar off.',
    ],
  },
  google: {
    label: 'Google',
    ways: [
      {
        title: null,
        steps: [
          'On a computer, open Google Calendar.',
          'Click Settings, then Settings.',
          'Under Settings for my calendars, click the calendar.',
          'Click Integrate calendar.',
          'Copy the Secret address in iCal format.',
          PASTE,
        ],
      },
    ],
    summary: null,
    notes: [
      'Google shows this address on a computer only.',
      'With a work or school account, your admin may have turned it off.',
      'If the link leaks, click Reset in the same place.',
    ],
  },
  outlook: {
    label: 'Outlook.com',
    ways: [
      {
        title: null,
        steps: [
          'On a computer, open Outlook.com and go to Calendar.',
          'Open Settings, then Calendar, then Shared calendars.',
          'Under Publish a calendar, pick the calendar and Can view titles and locations.',
          'Click Publish, then copy the ICS link.',
          PASTE,
        ],
      },
    ],
    summary: null,
    notes: [
      'Outlook publishes calendars from a computer only.',
      'To change the link, use Reset links or Unpublish there.',
    ],
  },
  yahoo: {
    label: 'Yahoo',
    ways: [],
    summary:
      'On a computer, open the calendar’s Share settings in Yahoo Calendar, copy its ICS link and paste it below.',
    notes: [
      'Yahoo’s help does not describe these links, so its menus may differ.',
      'To stop sharing, turn the shareable link off.',
    ],
  },
})

/** With events from Google Calendar switched on, the Google choice offers them instead. */
export const GOOGLE_EVENTS_NOTE = 'Or show events from Google Calendar above, with no link.'

/** The notes every provider's steps end with: the link is a key, and it is not live. */
export const SHARED_NOTES = Object.freeze({
  key: 'This link works like a password: anyone who has it can read every event on that calendar, so keep it private.',
  separate:
    'A separate calendar for outdoor plans shares less and stays under Solara’s 1 MB limit.',
  refresh: `Solara checks the link about every ${EVENT_SUBSCRIPTION_LIMITS.refreshHours} hours, so changes can take a few hours to show.`,
})
