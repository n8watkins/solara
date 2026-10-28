// The place search proxy: Open-Meteo's geocoding search on its commercial plan, with the
// key kept on the server (finding L3).
//
// Open-Meteo's terms make the free API non-commercial for every API, geocoding included,
// and its paid plans include the Geocoding API on the customer host. So once the forecast
// proxy is on (FORECAST_PROXY_ENABLED, after the plan is bought), the app's place search
// comes here instead of calling the free API from the browser.
//
// Answers are cached in memory per instance (a place name's matches rarely change), and
// cache misses count against the same global upstream budget as the forecasts
// (upstream-budget.ts), because they spend the same plan's calls. While the cost guard is
// engaged, only cached answers are served.

import { type GeocodingResult, parseGeocodingResponse } from '#core'
import type { Request } from 'firebase-functions/v2/https'

import { HttpError, loggableError } from '../shared/errors'
import { ThrottledLog } from '../shared/log-throttle'

/** Open-Meteo's commercial geocoding search: the customer host, with the plan's key. */
export const OPEN_METEO_CUSTOMER_GEOCODING_URL =
  'https://customer-geocoding-api.open-meteo.com/v1/search'
/** The most matches the app asks for (lib/geocoding.ts asks for 5, or 10 to filter). */
export const MAX_PLACE_RESULTS = 10
/** Longer names are not places; the app's input is short. */
export const MAX_PLACE_NAME_LENGTH = 80
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 2000
const UPSTREAM_TIMEOUT_MS = 5000

export interface PlaceSearch {
  name: string
  count: number
}

/** The search a request asks for, or a 400. */
export function requestedSearch(query: Request['query']): PlaceSearch {
  const rawName = query.name
  const rawCount = query.count ?? '5'
  if (typeof rawName !== 'string' || typeof rawCount !== 'string') {
    throw new HttpError('invalid-argument', 'Invalid search')
  }
  const name = rawName.trim().replace(/\s+/g, ' ')
  const count = Number(rawCount)
  if (
    name.length < 2 ||
    name.length > MAX_PLACE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    !/^\d{1,2}$/.test(rawCount) ||
    count < 1 ||
    count > MAX_PLACE_RESULTS
  ) {
    throw new HttpError('invalid-argument', 'Invalid search')
  }
  return { name, count }
}

export interface PlaceSearchCacheOptions {
  /** The plan's API key, or null when none is configured. */
  apiKey: () => string | null
  /** Whether the cost guard allows calls upstream (shared/cost-guard.ts). */
  upstreamAllowed: () => Promise<boolean>
  /** The global budget for upstream calls (upstream-budget.ts). */
  upstreamBudget: { take: () => Promise<boolean> }
  base?: string
  now?: () => number
  fetchImpl?: typeof fetch
}

export class PlaceSearchCache {
  private readonly memory = new Map<string, { expiresAt: number; results: GeocodingResult[] }>()
  private readonly inFlight = new Map<string, Promise<GeocodingResult[]>>()
  private readonly logs = new ThrottledLog()

  constructor(private readonly options: PlaceSearchCacheOptions) {}

  /** The matches for a search: cached, or fetched within the budget, or a 503. */
  async search({ name, count }: PlaceSearch): Promise<{ results: GeocodingResult[] }> {
    const key = `${count}:${name.toLowerCase()}`
    const now = (this.options.now ?? Date.now)()
    const cached = this.memory.get(key)
    if (cached && cached.expiresAt > now) return { results: cached.results }
    let pending = this.inFlight.get(key)
    if (!pending) {
      pending = this.fetch(name, count, key, now).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, pending)
    }
    return { results: await pending }
  }

  clear(): void {
    this.memory.clear()
    this.inFlight.clear()
    this.logs.clear()
  }

  private async fetch(
    name: string,
    count: number,
    key: string,
    now: number,
  ): Promise<GeocodingResult[]> {
    const unavailable = (reason: string, error?: unknown): never => {
      this.logs.log('warn', reason, 'place search unavailable', {
        reason,
        ...(error ? { error: loggableError(error) } : {}),
      })
      throw new HttpError('unavailable', 'Place search unavailable. Try again shortly.', {
        cause: error ?? new Error(reason),
      })
    }
    const apiKey = this.options.apiKey()
    if (!apiKey) return unavailable('no provider')
    if (!(await this.options.upstreamAllowed())) return unavailable('cost guard')
    if (!(await this.options.upstreamBudget.take())) return unavailable('upstream budget')

    const params = new URLSearchParams({
      name,
      count: String(count),
      language: 'en',
      format: 'json',
      apikey: apiKey,
    })
    let results: GeocodingResult[]
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `${this.options.base ?? OPEN_METEO_CUSTOMER_GEOCODING_URL}?${params}`,
        { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
      )
      if (!response.ok) throw new Error(`Place search failed: ${response.status}`)
      // Only the validated fields go back to the browser.
      results = parseGeocodingResponse(await response.json())
    } catch (error) {
      return unavailable('upstream failed', error)
    }
    this.memory.delete(key)
    this.memory.set(key, { expiresAt: now + CACHE_TTL_MS, results })
    if (this.memory.size > MAX_CACHE_ENTRIES) {
      const oldest = this.memory.keys().next()
      if (!oldest.done) this.memory.delete(oldest.value)
    }
    return results
  }
}
