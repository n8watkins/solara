// Per-account record caps (REVIEW4 M4; default, owner may change): the one place the
// numbers live. Imported events (events.ts) and scheduled activities (scheduled.ts) carry
// them in their limits, the key-list maths (key-lists.ts) enforces them, and
// firestore.rules repeat them (checked by lib/firestore-rules.test.ts). A module of its
// own, with no imports, so the key-list code never pulls the record schemas into a bundle.

/** Most records each collection may hold per account. */
export const RECORD_CAPS = Object.freeze({ events: 1000, scheduled: 500 })

/** Largest list query each collection's rules allow (`request.query.limit`). */
export const RECORD_LIST_LIMITS = Object.freeze({ events: 200, scheduled: 100 })
