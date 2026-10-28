// Where the Events section keeps the account's imported events. Without a provider it
// uses Firestore (firestoreEventsStore in lib/events.ts); the UI harness provides an
// in-memory store. Only the lazily loaded Events section and the harness import this.
import { createContext } from 'react'
import type { EventsStore } from './events'

export const EventsStoreContext = createContext<EventsStore | null>(null)
