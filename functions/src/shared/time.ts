import type { FieldValue } from 'firebase-admin/firestore'

/**
 * Milliseconds since the epoch of a `Date` or Firestore `Timestamp`, or `NaN` for
 * anything else (missing fields, legacy numbers, malformed data).
 */
export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  const timestamp = value as { toMillis?: unknown } | null | undefined
  if (timestamp && typeof timestamp.toMillis === 'function') {
    return (timestamp as { toMillis: () => number }).toMillis()
  }
  return Number.NaN
}

/** Returns a server-timestamp sentinel; injected so tests can pass a fixed value. */
export type ServerTimestamp = () => FieldValue
