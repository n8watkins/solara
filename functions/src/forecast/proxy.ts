// The forecast proxy: the app's forecast from Open-Meteo's commercial API, with the key
// kept on the server.
//
// One forecast is served per place (coordinates snapped to a FORECAST_GRID_DEGREES grid,
// about 2 km) and UTC hour. Each instance keeps recent forecasts in memory, and all
// instances share `forecastCache/{place}` in Firestore, so a place costs at most one
// upstream call an hour however many people look at it. The forecast proxy, the
// calendar feed and the Pro alerts all read through this cache. Concurrent requests for
// one place share one upstream call. The upstream call times out after 5 seconds.
//
// A cache miss calls upstream only when the provider is configured, the cost guard
// allows it, the global upstream budget is not known to be spent, the caller's own
// limit allows it (`mayFetch`: the proxy's per-caller share, caller-share.ts, or the
// feed's per-feed budget) and the global upstream budget has a call left
// (upstream-budget.ts, finding M1). Otherwise, or when the call fails, the last good
// forecast is served: up to 12 hours old when Solara itself declined to call upstream
// (cost guard, budget, caller share; REVIEW4 H1), up to 6 hours old when the call
// failed. `lookup` says when a forecast is such a stale copy, and the proxy tells the
// browser. A fallback is remembered in memory for a few minutes, so a flood does not
// turn into one Firestore read and one log line per request (finding L1).
//
// Every entry records the API it came from (REVIEW4 L7). Forecasts from Open-Meteo's
// free API (the calendar feed's provider until the commercial key is set, while billing
// is off) are never written to the shared Firestore cache, and a cache whose provider is
// not the free API never serves a free or untagged entry, so the free tier cannot end up
// in a commercial answer.

import {
  type ForecastProvider,
  type OpenMeteoResponse,
  appForecastRequest,
  fetchProviderForecast,
  openMeteoFree,
  parseOpenMeteoResponse,
  roundCoordinate,
} from '#core'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

import { HttpError, loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'
import { toMillis } from '../shared/time'
import { RETENTION_DAYS, expiresAfter } from '../shared/ttl'

export const FORECAST_CACHE_COLLECTION = 'forecastCache'
/** A forecast older than this is no longer served when the provider fails. */
export const LAST_GOOD_MAX_AGE_MS = 6 * 60 * 60 * 1000
/**
 * A forecast older than this is no longer served when Solara declined to call upstream:
 * the cost guard, the global budget or the caller's share (REVIEW4 H1; default, owner
 * may change). A 12-hour-old forecast still holds the day's hourly UV curve, which is
 * better than no forecast; `forecastCache` keeps entries a day.
 */
export const BUDGET_LAST_GOOD_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** Fallback reasons where Solara, not the provider, declined the upstream call. */
const DECLINED = new Set(['cost guard', 'upstream budget', 'caller limit'])
export const UPSTREAM_TIMEOUT_MS = 5000
/** How long a served fallback (or a place with none) is remembered before trying again. */
export const FALLBACK_RETRY_MS = 5 * 60 * 1000
/**
 * The cache grid, in degrees. 0.02 degree (at most about 1.1 km from the asked-for point)
 * changed the whole-number UV of 0.8% of daylight hours in a sample of 32 cities, against
 * 5.2% for 0.05 and 8.4% for 0.1 degree (docs/DEPLOYMENT.md, "Forecast proxy").
 */
export const FORECAST_GRID_DEGREES = 0.02
const MAX_MEMORY_ENTRIES = 500
const COORDINATE = /^-?\d{1,3}(?:\.\d{1,6})?$/

export interface Place {
  lat: number
  lon: number
}

interface CachedForecast {
  hour: string
  fetchedAt: number
  /** The provider's name (`ForecastProvider.name`), or '' for an untagged entry. */
  source: string
  forecast: OpenMeteoResponse
}

/** What an instance remembers for a place: a forecast, or that it has none for now. */
interface Remembered {
  /** The forecast's hour, or '' when nothing could be served. */
  hour: string
  fetchedAt: number
  source: string
  forecast: OpenMeteoResponse | null
  /** Set for a fallback: serve this without asking again until then. */
  retryAt?: number
}

/** A served forecast, and whether it is a stale copy from an earlier hour. */
export interface ServedForecast {
  forecast: OpenMeteoResponse
  /** When the forecast was fetched from upstream. */
  fetchedAt: number
  /** True when it is a last good copy from an earlier hour, not this hour's. */
  stale: boolean
}

/** A place snapped to the cache grid. */
export function gridPlace({ lat, lon }: Place): Place {
  // In whole hundredths, so a point halfway between cells always snaps the same way.
  const step = Math.round(FORECAST_GRID_DEGREES * 100)
  const snap = (value: number) => (Math.round(Math.round(value * 100) / step) * step) / 100 || 0
  return { lat: snap(lat), lon: snap(lon) }
}

/** The place a request asks for, rounded to 0.01 degree (the cache snaps it further), or a 400. */
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
  /** The upstream provider, or null when none may be called (no commercial key). */
  provider: () => ForecastProvider | null
  /** Whether the cost guard allows calls upstream (shared/cost-guard.ts). */
  upstreamAllowed: () => Promise<boolean>
  /** The global budget for upstream calls; omitted only for the bounded Pro alerts. */
  upstreamBudget?: { take: () => Promise<boolean>; available?: () => boolean }
  now?: () => number
  fetchImpl?: typeof fetch
}

export interface ForecastLookup {
  /**
   * The caller's own limit on cache misses, asked only when a miss would call upstream
   * and the global budget is not known to be spent.
   */
  mayFetch?: () => boolean | Promise<boolean>
}

export class ForecastCache {
  private readonly memory = new Map<string, Remembered>()
  private readonly inFlight = new Map<string, Promise<ServedForecast>>()
  private readonly logs = new ThrottledLog()

  constructor(private readonly options: ForecastCacheOptions) {}

  /** The forecast for a place: cached for this hour, fetched, or the last good one. */
  async get(asked: Place, lookup: ForecastLookup = {}): Promise<OpenMeteoResponse> {
    return (await this.lookup(asked, lookup)).forecast
  }

  /** Like `get`, and says whether the forecast is a stale copy from an earlier hour. */
  async lookup(asked: Place, lookup: ForecastLookup = {}): Promise<ServedForecast> {
    const place = gridPlace(asked)
    const key = placeKey(place)
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const work = this.resolve(key, place, lookup).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, work)
    return work
  }

  clear(): void {
    this.memory.clear()
    this.inFlight.clear()
    this.logs.clear()
  }

  private async resolve(
    key: string,
    place: Place,
    lookup: ForecastLookup,
  ): Promise<ServedForecast> {
    const now = (this.options.now ?? Date.now)()
    const hour = forecastHour(now)
    const provider = this.options.provider()
    // Free-API forecasts serve only a cache that itself uses the free API (REVIEW4 L7).
    const acceptable = (entry: { source: string } | null | undefined) =>
      !!entry &&
      (entry.source === openMeteoFree.name
        ? provider?.name === openMeteoFree.name
        : entry.source !== '')
    const served = (entry: { hour: string; fetchedAt: number; forecast: OpenMeteoResponse }) => ({
      forecast: entry.forecast,
      fetchedAt: entry.fetchedAt,
      stale: entry.hour !== hour,
    })
    const inMemory = this.memory.get(key)
    const remembered = acceptable(inMemory) ? inMemory : undefined
    if (remembered?.forecast && remembered.hour === hour) {
      return served({ ...remembered, forecast: remembered.forecast })
    }
    if (remembered?.retryAt !== undefined && now < remembered.retryAt) {
      if (remembered.forecast) return served({ ...remembered, forecast: remembered.forecast })
      throw new HttpError('unavailable', 'Forecast unavailable. Try again shortly.')
    }

    const ref = this.options.db.collection(FORECAST_CACHE_COLLECTION).doc(key)
    const read = await this.readStored(ref)
    const stored = acceptable(read) ? read : null
    if (stored?.hour === hour) {
      this.remember(key, stored)
      return served(stored)
    }

    const lastGood = [remembered, stored]
      .filter((entry): entry is CachedForecast => !!entry?.forecast)
      .sort((a, b) => b.fetchedAt - a.fetchedAt)[0]
    const serveLastGood = (reason: string, error?: unknown) => {
      const maxAge = DECLINED.has(reason) ? BUDGET_LAST_GOOD_MAX_AGE_MS : LAST_GOOD_MAX_AGE_MS
      const usable = lastGood && now - lastGood.fetchedAt <= maxAge
      // Remembered for a few minutes, so the next requests for this place cost no
      // Firestore read, no upstream attempt and no log line. Not when only this caller's
      // own limit said no: another caller may still fetch the place.
      if (reason !== 'caller limit') {
        this.remember(key, {
          hour: usable ? lastGood.hour : '',
          fetchedAt: usable ? lastGood.fetchedAt : now,
          source: usable ? lastGood.source : (provider?.name ?? 'none'),
          forecast: usable ? lastGood.forecast : null,
          retryAt: now + FALLBACK_RETRY_MS,
        })
      }
      // No coordinates in the log: they locate people. One line a minute per reason.
      this.logs.log(
        'warn',
        `${reason}:${usable ? 'served' : 'none'}`,
        usable ? 'forecast served from the last good copy' : 'forecast unavailable',
        {
          reason,
          ...(usable ? { ageMs: now - lastGood.fetchedAt } : {}),
          ...(error ? { error: loggableError(error) } : {}),
        },
      )
      if (usable) return served(lastGood)
      throw new HttpError('unavailable', 'Forecast unavailable. Try again shortly.', {
        cause: error ?? new Error(reason),
      })
    }

    if (!provider) return serveLastGood('no provider')
    if (!(await this.options.upstreamAllowed())) return serveLastGood('cost guard')
    const budget = this.options.upstreamBudget
    // A spent budget is known in memory; asking the caller's share then would only waste it.
    if (budget?.available && !budget.available()) return serveLastGood('upstream budget')
    if (lookup.mayFetch && !(await lookup.mayFetch())) return serveLastGood('caller limit')
    if (budget && !(await budget.take())) return serveLastGood('upstream budget')

    let forecast: OpenMeteoResponse
    try {
      forecast = await fetchProviderForecast(provider, appForecastRequest(place.lat, place.lon), {
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        fetchImpl: this.options.fetchImpl,
      })
    } catch (error) {
      return serveLastGood('upstream failed', error)
    }
    const entry = { hour, fetchedAt: now, source: provider.name, forecast }
    this.remember(key, entry)
    // The free API's forecasts stay in this instance's memory (REVIEW4 L7).
    if (provider.name === openMeteoFree.name) return served(entry)
    try {
      await ref.set({
        hour,
        fetchedAt: new Date(now),
        source: provider.name,
        payload: JSON.stringify(forecast),
        expireAt: expiresAfter(RETENTION_DAYS.forecastCache, new Date(now)),
      })
    } catch (error) {
      // The forecast is good; only sharing it with other instances failed.
      this.logs.log('warn', 'write-failed', 'forecast cache could not be written', {
        error: loggableError(error),
      })
    }
    return served(entry)
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
        source: typeof data.source === 'string' ? data.source : '',
        forecast: parseOpenMeteoResponse(JSON.parse(data.payload)),
      }
    } catch (error) {
      this.logs.log('warn', 'read-failed', 'forecast cache could not be read', {
        error: loggableError(error),
      })
      return null
    }
  }

  private remember(key: string, entry: Remembered): void {
    this.memory.delete(key)
    this.memory.set(key, entry)
    if (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next()
      if (!oldest.done) this.memory.delete(oldest.value)
    }
  }
}
