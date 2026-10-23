// Test helper: run code as if the device were in different time zones.
//
// Node re-reads process.env.TZ on assignment (Date and the Intl default zone),
// so one test run can prove a result does not depend on the device's zone.

/** Device zones every zone-sensitive test runs under. */
export const DEVICE_ZONES = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'] as const

/** Run `fn` once per device zone and return each result, keyed by zone. */
export function withDeviceZones<T>(fn: (zone: string) => T): Record<string, T> {
  const original = process.env.TZ
  const results: Record<string, T> = {}
  try {
    for (const zone of DEVICE_ZONES) {
      process.env.TZ = zone
      if (Intl.DateTimeFormat().resolvedOptions().timeZone !== zone) {
        throw new Error(`Runtime ignored TZ=${zone}`)
      }
      results[zone] = fn(zone)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
  return results
}
