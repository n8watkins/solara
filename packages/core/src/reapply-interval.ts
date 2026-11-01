// How often the sunscreen reapply timer reminds (reapply.ts), apart from its words, so
// the dashboard's first load can show the idle timer's text without them.

/** Minutes between reminders. */
export const REAPPLY_MINUTES = Object.freeze({ standard: 120, water: 80 })

/** 'standard' reminds every 2 hours, 'water' every 80 minutes. */
export type ReapplyMode = 'standard' | 'water'
