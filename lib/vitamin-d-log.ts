// The vitamin D log in this browser (ROADMAP item 48): device only, like the guest plan
// (lib/guest.ts), under a `solara_` key per owner (the guest, or each account; see
// lib/vitamin-d-switch.ts). Every read and write keeps only valid
// entries from the last year (@solara/core/vitamin-d-log keptEntries), so old sessions
// are pruned without a job. Loaded only with the log and the account page's download.
import { keptEntries, parseLog, storedLog, type VitaminDEntry } from '@solara/core/vitamin-d-log'
import { requestPersistentStorage } from './persistent-storage'
import { clearVitaminDLog, vitaminDLogKey, type LogOwner } from './vitamin-d-switch'

export { clearVitaminDLog }

/** `owner`'s log in this browser on `today` (YYYY-MM-DD), newest first. */
export function loadVitaminDLog(owner: LogOwner, today: string): VitaminDEntry[] {
  try {
    const raw = localStorage.getItem(vitaminDLogKey(owner))
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
 * Keeps `entries` as `owner`'s log (pruned like a read) and returns what was kept. An empty log removes the
 * key. Throws LogStorageError when the browser refuses.
 */
export function saveVitaminDLog(
  owner: LogOwner,
  entries: readonly VitaminDEntry[],
  today: string,
): VitaminDEntry[] {
  const kept = keptEntries(entries, today)
  const key = vitaminDLogKey(owner)
  let first = false
  try {
    first = localStorage.getItem(key) === null
    if (kept.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(storedLog(kept)))
  } catch (error) {
    throw new LogStorageError({ cause: error })
  }
  // The log's first session asks the browser to keep this site's storage, as setup does
  // for the guest plan (#170): the log has no other copy.
  if (first && kept.length > 0) void requestPersistentStorage()
  return kept
}

/** A new entry id: random, URL-safe. */
export function newEntryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('')
}
