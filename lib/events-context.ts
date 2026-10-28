// Where the Events section keeps the account's imported events, linked calendars and
// Google Calendar and Outlook connections. Without a provider it uses Firestore, the
// server, Google and Microsoft (firestoreEventsStore in lib/events.ts,
// serverSubscriptionsStore in lib/event-subscriptions.ts, firestoreGoogleLinkStore and
// googleCalendarApi in lib/google-events.ts, firestoreOutlookLinkStore and
// outlookCalendarApi in lib/outlook-events.ts); the UI harness provides in-memory stores
// and fakes. Only the lazily loaded Events section and the harness import this.
import { createContext } from 'react'
import type { SubscriptionsStore } from './event-subscriptions'
import type { EventsStore } from './events'
import type { GoogleCalendarApi, GoogleLinkStore } from './google-events'
import type { OutlookCalendarApi, OutlookLinkStore } from './outlook-events'

export const EventsStoreContext = createContext<EventsStore | null>(null)

export const SubscriptionsStoreContext = createContext<SubscriptionsStore | null>(null)

export const GoogleLinkStoreContext = createContext<GoogleLinkStore | null>(null)

export const GoogleCalendarApiContext = createContext<GoogleCalendarApi | null>(null)

export const OutlookLinkStoreContext = createContext<OutlookLinkStore | null>(null)

export const OutlookCalendarApiContext = createContext<OutlookCalendarApi | null>(null)
