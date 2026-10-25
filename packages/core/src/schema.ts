// Building blocks for the Valibot schemas at every boundary (stored preferences,
// Open-Meteo, geocoding, Functions responses, scheduled activities, the forecast
// cache). Valibot is modular, so the web app downloads only the checks it uses.
//
// Two of Valibot's defaults are looser than the rules these boundaries keep, so the
// schemas use these instead of the bare ones:
// - `finiteNumber` rejects Infinity as well as NaN (`v.number()` accepts Infinity);
// - `record` and `looseRecord` accept only a plain object, never an array
//   (`v.object()` accepts anything typed "object").

import * as v from 'valibot'

/** Whether `value` is a non-null object that is not an array. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const plainRecord = v.custom<Record<string, unknown>>(isPlainRecord)

/** A finite number. */
export const finiteNumber = v.pipe(v.number(), v.finite())

/** A plain object with these entries; other keys are dropped. */
export function record<const Entries extends v.ObjectEntries>(entries: Entries) {
  return v.pipe(plainRecord, v.object(entries))
}

/** A plain object with these entries; other keys are kept as they are. */
export function looseRecord<const Entries extends v.ObjectEntries>(entries: Entries) {
  return v.pipe(plainRecord, v.looseObject(entries))
}
