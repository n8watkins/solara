// Geocoding responses (Open-Meteo place search and OpenStreetMap Nominatim reverse
// lookup) validated at the boundary with zod/mini, plus the coordinate rounding every
// stored or transmitted position goes through.

import * as z from 'zod/mini'

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
const optionalText = z.catch(z.optional(z.string()), undefined)

/** One Open-Meteo place search result. Results without a usable position or name are dropped. */
export const GeocodingResultSchema = z.object({
  latitude: z.number().check(z.gte(-90), z.lte(90)),
  longitude: z.number().check(z.gte(-180), z.lte(180)),
  name: z.string().check(z.trim(), z.minLength(1)),
  admin1: optionalText,
  admin2: optionalText,
  country: optionalText,
  country_code: optionalText,
  timezone: optionalText,
})

export type GeocodingResult = z.infer<typeof GeocodingResultSchema>

/** Open-Meteo omits `results` when nothing matches. */
const GeocodingResponseSchema = z.object({
  results: z.optional(z.array(z.catch(z.nullable(GeocodingResultSchema), null))),
})

/**
 * The usable results of an Open-Meteo place search (empty when nothing matched).
 * Throws when the response does not have the documented shape.
 */
export function parseGeocodingResponse(raw: unknown): GeocodingResult[] {
  const parsed = GeocodingResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Location search returned an unexpected response')
  return (parsed.data.results ?? []).filter(result => result !== null)
}

/** The address parts of a Nominatim reverse lookup that Solara reads. */
const ReverseGeocodeAddressSchema = z.object({
  city: optionalText,
  town: optionalText,
  village: optionalText,
  municipality: optionalText,
  state: optionalText,
  country: optionalText,
})

export type ReverseGeocodeAddress = z.infer<typeof ReverseGeocodeAddressSchema>

/** Nominatim answers `{ error }` without an address for places it cannot name (the open sea). */
const ReverseGeocodeResponseSchema = z.object({
  address: z.catch(z.optional(ReverseGeocodeAddressSchema), undefined),
})

/**
 * The address of a Nominatim reverse lookup (empty when it has none).
 * Throws when the response is not a JSON object.
 */
export function parseReverseGeocodeResponse(raw: unknown): ReverseGeocodeAddress {
  const parsed = ReverseGeocodeResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Reverse geocoding returned an unexpected response')
  return parsed.data.address ?? {}
}
