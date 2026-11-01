// The words of "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md, ROADMAP item
// 24): one object per provider, so the wording can change without touching the panel
// (components/events/AddCalendarGuide.tsx). Every step is one short sentence
// (lib/calendar-guide.test.ts checks it). Steps follow the providers' own help pages as
// cited in the document; Yahoo's are unconfirmed there, so Yahoo has no numbered steps.
import { EVENT_SUBSCRIPTION_LIMITS, type CalendarProvider } from '@solara/core/event-import'
import m from '@/messages/linked'

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

// Read when shown, in the page's language (messages/linked.ts).
export const CALENDAR_GUIDES: Readonly<Record<CalendarProvider, CalendarGuide>> = Object.freeze({
  get icloud(): CalendarGuide {
    return {
      label: m.icloudLabel,
      ways: [
        {
          title: m.onComputer,
          steps: [m.icloudStep1, m.icloudStep2, m.icloudStep3, m.pasteBelow],
        },
        {
          title: m.onPhone,
          steps: [m.icloudPhoneStep1, m.icloudPhoneStep2, m.icloudPhoneStep3, m.pasteBelow],
        },
      ],
      summary: null,
      notes: [m.icloudNote1, m.icloudNote2],
    }
  },
  get google(): CalendarGuide {
    return {
      label: m.googleLabel,
      ways: [
        {
          title: null,
          steps: [
            m.googleStep1,
            m.googleStep2,
            m.googleStep3,
            m.googleStep4,
            m.googleStep5,
            m.pasteBelow,
          ],
        },
      ],
      summary: null,
      notes: [m.googleNote1, m.googleNote2, m.googleNote3],
    }
  },
  get outlook(): CalendarGuide {
    return {
      label: m.outlookLabel,
      ways: [
        {
          title: null,
          steps: [m.outlookStep1, m.outlookStep2, m.outlookStep3, m.outlookStep4, m.pasteBelow],
        },
      ],
      summary: null,
      notes: [m.outlookNote1, m.outlookNote2],
    }
  },
  get yahoo(): CalendarGuide {
    return {
      label: m.yahooLabel,
      ways: [],
      summary: m.yahooSummary,
      notes: [m.yahooNote1, m.yahooNote2],
    }
  },
})

/** With events from Google Calendar switched on, the Google choice offers them instead. */
export function googleEventsNote(): string {
  return m.googleEventsNote
}

/** The notes every provider's steps end with: the link is a key, and it is not live. */
export const SHARED_NOTES = Object.freeze({
  get key() {
    return m.sharedKey
  },
  get separate() {
    return m.sharedSeparate
  },
  get refresh() {
    return m.sharedRefresh(EVENT_SUBSCRIPTION_LIMITS.refreshHours)
  },
})
