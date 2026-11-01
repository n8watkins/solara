// The vitamin D log in this browser (ROADMAP item 48): device only, like the guest plan
// (lib/guest.ts), under its own `solara_` key. Every read and write keeps only valid
// entries from the last year (@solara/core/vitamin-d-log keptEntries), so old sessions
// are pruned without a job. Loaded only with the log and the account page's download.
import {
  keptEntries,
  parseLog,
  storedLog,
  type VitaminDEntry,
} from '@solara/core/vitamin-d-log'
import { clearVitaminDLog, VITAMIN_D_LOG_KEY } from './vitamin-d-switch'

export { clearVitaminDLog }

/** The log kept in this browser on `today` (YYYY-MM-DD), newest first. */
export function loadVitaminDLog(today: string): VitaminDEntry[] {
  try {
    const raw = localStorage.getItem(VITAMIN_D_LOG_KEY)
    return raw ? parseLog(JSON.parse(raw), today) : []
  } catch {
    return []
  }
}

/** The browser refused to store the log (storage full, blocked or unavailable). */
export class LogStorageError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Could not save the vitamin D log in this browser.', options)
    this.name = 'LogStorageError'
  }
}

/**
 * Keeps `entries` (pruned like a read) and returns what was kept. An empty log removes the
 * key. Throws LogStorageError when the browser refuses.
 */
export function saveVitaminDLog(entries: readonly VitaminDEntry[], today: string): VitaminDEntry[] {
  const kept = keptEntries(entries, today)
  try {
    if (kept.length === 0) localStorage.removeItem(VITAMIN_D_LOG_KEY)
    else localStorage.setItem(VITAMIN_D_LOG_KEY, JSON.stringify(storedLog(kept)))
  } catch (error) {
    throw new LogStorageError({ cause: error })
  }
  return kept
}

/** A new entry id: random, URL-safe. */
export function newEntryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('')
}
