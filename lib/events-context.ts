// Where the Events section keeps the account's imported events and linked calendars.
// Without a provider it uses Firestore and the server (firestoreEventsStore in
// lib/events.ts, serverSubscriptionsStore in lib/event-subscriptions.ts); the UI harness
// provides in-memory stores. Only the lazily loaded Events section and the harness
// import this.
import { createContext } from 'react'
import type { SubscriptionsStore } from './event-subscriptions'
import type { EventsStore } from './events'

export const EventsStoreContext = createContext<EventsStore | null>(null)

export const SubscriptionsStoreContext = createContext<SubscriptionsStore | null>(null)
