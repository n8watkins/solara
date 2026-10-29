// The forecast cache in memory: one entry per location, shared by every screen that
// shows that location (the dashboard and the calendar). It owns fetching:
// - one request per location at a time, aborted when no screen needs it any more
//   (for example after switching location);
// - a forecast older than `staleMs` is refreshed in the background while the cached
//   one stays on screen: when a screen starts showing it, every `staleMs` while one
//   does, and when the page becomes visible again or the browser comes back online;
// - a failed request is tried once more after `retryDelayMs`, then, while a screen
//   shows the location, again every `errorRetryMs` until one succeeds (the screens say
//   so); offline, nothing is requested until the browser is back online;
// - each entry starts from the persisted cache (lib/cache.ts), so a reload or a
//   location switch paints the last known forecast at once.
//
// It is plain TypeScript with no React; lib/use-forecast.ts connects it to the
// screens with useSyncExternalStore. (It replaced TanStack Query, which the app used
// for this one query and which cost the first load about 7 KB gzip.)
import type { ForecastData, Location } from './types'

/** What a screen sees for one location. A new object whenever anything changes. */
export interface ForecastState {
  /** The latest forecast, or undefined until one has loaded. */
  readonly data: ForecastData | undefined
  /** When `data` was fetched (ms since the epoch); 0 without data. */
  readonly updatedAt: number
  /** The last request failed, after its retry. `data`, if any, is the last good one. */
  readonly error: boolean
  /** No forecast yet, and no request has failed. */
  readonly pending: boolean
}

export interface ForecastStoreOptions {
  /** Fetches a fresh forecast (and persists it). Must honor `signal`. */
  fetchForecast: (location: Location, signal: AbortSignal) => Promise<ForecastData>
  /** The persisted forecast for a location, if any (lib/cache.ts). */
  readCache: (location: Location) => ForecastData | null
  /** Location key: places that share one forecast share one key. */
  keyOf: (location: Location) => string
  /** A forecast older than this is refreshed. */
  staleMs: number
  /** Wait before the one quick retry of a failed request. */
  retryDelayMs?: number
  /** After a request and its quick retry failed: wait before trying again. */
  errorRetryMs?: number
  /** An entry no screen has shown for this long is dropped from memory. */
  gcMs?: number
  now?: () => number
}

interface Entry {
  key: string
  location: Location
  state: ForecastState
  /** The request in flight, if any. */
  request: AbortController | null
  /** Set while a request is wanted but the browser is offline. */
  waitingForNetwork: boolean
  listeners: Set<() => void>
  refreshTimer: ReturnType<typeof setInterval> | null
  /** The next try after a failure, while a screen shows the location. */
  retryTimer: ReturnType<typeof setTimeout> | null
  gcTimer: ReturnType<typeof setTimeout> | null
}

function stateFrom(data: ForecastData | undefined, error: boolean): ForecastState {
  return { data, updatedAt: data?.fetchedAt ?? 0, error, pending: !data && !error }
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export class ForecastStore {
  private readonly entries = new Map<string, Entry>()
  private readonly options: Required<ForecastStoreOptions>
  private watching = false

  constructor(options: ForecastStoreOptions) {
    this.options = {
      retryDelayMs: 1000,
      errorRetryMs: 60_000,
      gcMs: 30 * 60 * 1000,
      now: Date.now,
      ...options,
    }
  }

  /** The current state for `location`. Stable until it changes. */
  getState(location: Location): ForecastState {
    return this.entry(location).state
  }

  /**
   * A screen starts showing `location`: `listener` runs on every change until the
   * returned function is called. Fetches when there is no fresh forecast.
   */
  subscribe(location: Location, listener: () => void): () => void {
    const entry = this.entry(location)
    entry.location = location
    if (entry.gcTimer) clearTimeout(entry.gcTimer)
    entry.gcTimer = null
    entry.listeners.add(listener)
    if (entry.listeners.size === 1) {
      entry.refreshTimer = setInterval(() => this.fetch(entry), this.options.staleMs)
      this.watchPage()
      if (this.isStale(entry)) this.fetch(entry)
    }
    return () => {
      if (!entry.listeners.delete(listener) || entry.listeners.size > 0) return
      if (entry.refreshTimer) clearInterval(entry.refreshTimer)
      entry.refreshTimer = null
      this.cancelRetry(entry)
      // Nobody needs the answer any more.
      entry.request?.abort()
      entry.request = null
      entry.waitingForNetwork = false
      entry.gcTimer = setTimeout(() => {
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
      }, this.options.gcMs)
      this.unwatchPageIfIdle()
    }
  }

  /**
   * Fetches `location` now, unless a request for it is already in flight (someone asked:
   * "Retry", or a new day). A failure on screen gives way to loading until it answers.
   */
  refetch(location: Location): void {
    const entry = this.entry(location)
    if (entry.state.error && online()) {
      this.set(entry, { ...entry.state, error: false, pending: !entry.state.data })
    }
    this.fetch(entry)
  }

  /**
   * Drops every forecast in memory and aborts every request (the account on screen
   * changed). Screens still showing a location start again from the persisted cache.
   */
  clear(): void {
    const previous = [...this.entries.values()]
    this.entries.clear()
    for (const old of previous) {
      old.request?.abort()
      if (old.refreshTimer) clearInterval(old.refreshTimer)
      this.cancelRetry(old)
      if (old.gcTimer) clearTimeout(old.gcTimer)
      if (old.listeners.size === 0) continue
      // Hand the screens over to a fresh entry for the same place.
      const fresh = this.entry(old.location)
      for (const listener of old.listeners) fresh.listeners.add(listener)
      fresh.refreshTimer = setInterval(() => this.fetch(fresh), this.options.staleMs)
      if (this.isStale(fresh)) this.fetch(fresh)
    }
    for (const old of previous) for (const listener of old.listeners) listener()
    this.unwatchPageIfIdle()
  }

  private entry(location: Location): Entry {
    const key = this.options.keyOf(location)
    let entry = this.entries.get(key)
    if (!entry) {
      const cached = this.options.readCache(location) ?? undefined
      entry = {
        key,
        location,
        state: stateFrom(cached, false),
        request: null,
        waitingForNetwork: false,
        listeners: new Set(),
        refreshTimer: null,
        retryTimer: null,
        gcTimer: null,
      }
      this.entries.set(key, entry)
    }
    return entry
  }

  private isStale(entry: Entry): boolean {
    return !entry.state.data || this.options.now() - entry.state.updatedAt >= this.options.staleMs
  }

  private set(entry: Entry, state: ForecastState): void {
    entry.state = state
    for (const listener of [...entry.listeners]) listener()
  }

  private cancelRetry(entry: Entry): void {
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    entry.retryTimer = null
  }

  private fetch(entry: Entry): void {
    if (entry.request || this.entries.get(entry.key) !== entry) return
    this.cancelRetry(entry)
    if (!online()) {
      entry.waitingForNetwork = true
      return
    }
    entry.waitingForNetwork = false
    const controller = new AbortController()
    entry.request = controller
    void this.run(entry, controller)
  }

  private async run(entry: Entry, controller: AbortController): Promise<void> {
    const { signal } = controller
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await this.options.fetchForecast(entry.location, signal)
        if (entry.request !== controller) return
        entry.request = null
        this.set(entry, stateFrom(data, false))
        return
      } catch {
        if (entry.request !== controller) return
        if (signal.aborted) {
          entry.request = null
          return
        }
        if (attempt === 0) {
          const retried = await new Promise<boolean>(resolve => {
            const timer = setTimeout(() => resolve(true), this.options.retryDelayMs)
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                resolve(false)
              },
              { once: true },
            )
          })
          if (retried && entry.request === controller) continue
          return
        }
        entry.request = null
        this.set(entry, { ...entry.state, error: true, pending: false })
        if (entry.listeners.size > 0) {
          entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null
            this.fetch(entry)
          }, this.options.errorRetryMs)
        }
        return
      }
    }
  }

  // ---- Page visibility and network ----------------------------------------------

  private readonly onWake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    for (const entry of this.entries.values()) {
      if (entry.listeners.size === 0) continue
      if (entry.waitingForNetwork || this.isStale(entry)) this.fetch(entry)
    }
  }

  private watchPage(): void {
    if (this.watching || typeof window === 'undefined') return
    this.watching = true
    document.addEventListener('visibilitychange', this.onWake)
    window.addEventListener('online', this.onWake)
  }

  private unwatchPageIfIdle(): void {
    if (!this.watching) return
    for (const entry of this.entries.values()) if (entry.listeners.size > 0) return
    this.watching = false
    document.removeEventListener('visibilitychange', this.onWake)
    window.removeEventListener('online', this.onWake)
  }
}
