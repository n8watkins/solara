// Geocoding responses (Open-Meteo place search and OpenStreetMap Nominatim reverse
// lookup) validated at the boundary with Valibot, plus the coordinate rounding every
// stored or transmitted position goes through.

import * as v from 'valibot'
import { finiteNumber, record } from './schema'

/**
 * Coordinates are rounded to 2 decimals (about 1 km) before they leave the
 * device or are stored. That is plenty for a UV forecast and a city name, and it
 * avoids sending or keeping an exact home position.
 */
export const COORDINATE_DECIMALS = 2

export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS
  // `+ 0` folds -0 into 0 so rounded values compare and serialize cleanly.
  return Math.round(value * factor) / factor + 0
}

/** An optional text field: anything that is not a string counts as missing. */
const optionalText = v.fallback(v.optional(v.string()), undefined)

/** One Open-Meteo place search result. Results without a usable position or name are dropped. */
export const GeocodingResultSchema = record({
  latitude: v.pipe(finiteNumber, v.minValue(-90), v.maxValue(90)),
  longitude: v.pipe(finiteNumber, v.minValue(-180), v.maxValue(180)),
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  admin1: optionalText,
  admin2: optionalText,
  country: optionalText,
  country_code: optionalText,
  timezone: optionalText,
})

export type GeocodingResult = v.InferOutput<typeof GeocodingResultSchema>

/** Open-Meteo omits `results` when nothing matches; the place search proxy answers the same. */
export const GeocodingResponseSchema = record({
  results: v.optional(v.array(v.fallback(v.nullable(GeocodingResultSchema), null))),
})

/**
 * The usable results of an Open-Meteo place search (empty when nothing matched).
 * Throws when the response does not have the documented shape.
 */
export function parseGeocodingResponse(raw: unknown): GeocodingResult[] {
  const parsed = v.safeParse(GeocodingResponseSchema, raw)
  if (!parsed.success) throw new Error('Location search returned an unexpected response')
  return (parsed.output.results ?? []).filter(result => result !== null)
}

/** The address parts of a Nominatim reverse lookup that Solara reads. */
const ReverseGeocodeAddressSchema = record({
  city: optionalText,
  town: optionalText,
  village: optionalText,
  municipality: optionalText,
  state: optionalText,
  country: optionalText,
})

export type ReverseGeocodeAddress = v.InferOutput<typeof ReverseGeocodeAddressSchema>

/** Nominatim answers `{ error }` without an address for places it cannot name (the open sea). */
const ReverseGeocodeResponseSchema = record({
  address: v.fallback(v.optional(ReverseGeocodeAddressSchema), undefined),
})

/**
 * The address of a Nominatim reverse lookup (empty when it has none).
 * Throws when the response is not a JSON object.
 */
export function parseReverseGeocodeResponse(raw: unknown): ReverseGeocodeAddress {
  const parsed = v.safeParse(ReverseGeocodeResponseSchema, raw)
  if (!parsed.success) throw new Error('Reverse geocoding returned an unexpected response')
  return parsed.output.address ?? {}
}
