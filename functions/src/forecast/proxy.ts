// The forecast proxy: the app's forecast from Open-Meteo's commercial API, with the key
// kept on the server.
//
// One forecast is served per place (coordinates rounded to 0.01 degree, about 1 km) and
// UTC hour. Each instance keeps recent forecasts in memory, and all instances share
// `forecastCache/{place}` in Firestore, so a place costs at most one upstream call an
// hour however many people look at it. Concurrent requests for one place share one
// upstream call. The upstream call times out after 5 seconds; when it fails, the last
// good forecast (at most 6 hours old) is served instead. While the cost guard is
// engaged, only cached forecasts are served.

import {
  type ForecastProvider,
  type OpenMeteoResponse,
  appForecastRequest,
  fetchProviderForecast,
  parseOpenMeteoResponse,
  roundCoordinate,
} from '#core'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { Request } from 'firebase-functions/v2/https'

import { HttpError, loggableError } from '../shared/errors'
import { toMillis } from '../shared/time'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'

export const FORECAST_CACHE_COLLECTION = 'forecastCache'
/** A forecast older than this is no longer served when the provider fails. */
export const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const UPSTREAM_TIMEOUT_MS = 5000
const MAX_MEMORY_ENTRIES = 500
const COORDINATE = /^-?\d{1,3}(?:\.\d{1,6})?$/

export interface Place {
  lat: number
  lon: number
}

interface CachedForecast {
  hour: string
  fetchedAt: number
  forecast: OpenMeteoResponse
}

/** The place a request asks for, rounded to the cache grid, or a 400. */
export function requestedPlace(query: Request['query']): Place {
  const lat = query.lat
  const lon = query.lon
  if (
    typeof lat !== 'string' ||
    typeof lon !== 'string' ||
    !COORDINATE.test(lat) ||
    !COORDINATE.test(lon)
  ) {
    throw new HttpError('invalid-argument', 'Invalid location')
  }
  const place = { lat: roundCoordinate(Number(lat)), lon: roundCoordinate(Number(lon)) }
  if (Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
    throw new HttpError('invalid-argument', 'Invalid location')
  }
  return place
}

/** The UTC hour a forecast belongs to, like `2026-10-27T14`. */
export function forecastHour(now: number): string {
  return new Date(now).toISOString().slice(0, 13)
}

export function placeKey({ lat, lon }: Place): string {
  return `${lat.toFixed(2)}_${lon.toFixed(2)}`
}

export interface ForecastCacheOptions {
  db: Firestore
  /** The upstream provider, or null when the commercial key is not configured. */
  provider: () => ForecastProvider | null
  /** Whether the cost guard allows calls upstream (shared/cost-guard.ts). */
  upstreamAllowed: () => Promise<boolean>
  now?: () => number
  fetchImpl?: typeof fetch
}

export class ForecastCache {
  private readonly memory = new Map<string, CachedForecast>()
  private readonly inFlight = new Map<string, Promise<OpenMeteoResponse>>()

  constructor(private readonly options: ForecastCacheOptions) {}

  /** The forecast for a place: cached for this hour, fetched, or the last good one. */
  async get(place: Place): Promise<OpenMeteoResponse> {
    const key = placeKey(place)
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const work = this.resolve(key, place).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, work)
    return work
  }

  clear(): void {
    this.memory.clear()
    this.inFlight.clear()
  }

  private async resolve(key: string, place: Place): Promise<OpenMeteoResponse> {
    const now = (this.options.now ?? Date.now)()
    const hour = forecastHour(now)
    const remembered = this.memory.get(key)
    if (remembered?.hour === hour) return remembered.forecast

    const ref = this.options.db.collection(FORECAST_CACHE_COLLECTION).doc(key)
    const stored = await this.readStored(ref)
    if (stored?.hour === hour) {
      this.remember(key, stored)
      return stored.forecast
    }

    const lastGood = [remembered, stored]
      .filter((entry): entry is CachedForecast => !!entry)
      .sort((a, b) => b.fetchedAt - a.fetchedAt)[0]
    const serveLastGood = (reason: string, error?: unknown) => {
      if (lastGood && now - lastGood.fetchedAt <= LAST_GOOD_MAX_AGE_MS) {
        // No coordinates in the log: they locate people.
        logger.warn('forecast served from the last good copy', {
          reason,
          ageMs: now - lastGood.fetchedAt,
          ...(error ? { error: loggableError(error) } : {}),
        })
        return lastGood.forecast
      }
      throw new HttpError('unavailable', 'Forecast unavailable. Try again shortly.', {
        cause: error ?? new Error(reason),
      })
    }

    const provider = this.options.provider()
    if (!provider) return serveLastGood('no provider')
    if (!(await this.options.upstreamAllowed())) return serveLastGood('cost guard')

    let forecast: OpenMeteoResponse
    try {
      forecast = await fetchProviderForecast(provider, appForecastRequest(place.lat, place.lon), {
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        fetchImpl: this.options.fetchImpl,
      })
    } catch (error) {
      return serveLastGood('upstream failed', error)
    }
    const entry = { hour, fetchedAt: now, forecast }
    this.remember(key, entry)
    try {
      await ref.set({
        hour,
        fetchedAt: new Date(now),
        payload: JSON.stringify(forecast),
        expireAt: expiresAfter(RETENTION_DAYS.forecastCache, new Date(now)),
      })
    } catch (error) {
      // The forecast is good; only sharing it with other instances failed.
      logger.warn('forecast cache could not be written', { error: loggableError(error) })
    }
    return forecast
  }

  private async readStored(ref: DocumentReference): Promise<CachedForecast | null> {
    try {
      const data = (await ref.get()).data()
      const fetchedAt = toMillis(data?.fetchedAt)
      if (!data || typeof data.hour !== 'string' || typeof data.payload !== 'string') return null
      if (!Number.isFinite(fetchedAt)) return null
      return {
        hour: data.hour,
        fetchedAt,
        forecast: parseOpenMeteoResponse(JSON.parse(data.payload)),
      }
    } catch (error) {
      logger.warn('forecast cache could not be read', { error: loggableError(error) })
      return null
    }
  }

  private remember(key: string, entry: CachedForecast): void {
    this.memory.delete(key)
    this.memory.set(key, entry)
    if (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next()
      if (!oldest.done) this.memory.delete(oldest.value)
    }
  }
}
