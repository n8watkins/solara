// The plain-object check shared by the Valibot schemas (./schema.ts) and the hand-written
// readers that run on a guest's first screen (forecast.ts, the guest plan check in the
// web app), kept apart from Valibot so those readers never import it.

/** Whether `value` is a non-null object that is not an array. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
