import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  initSentry: vi.fn(),
  loaded: vi.fn(),
}))

vi.mock('./sentry-client', () => {
  mocks.loaded()
  return { initSentry: mocks.initSentry }
})

const DSN = 'https://abc123public@o11.ingest.us.sentry.io/22'

type Listener = (event: unknown) => void

/** A minimal browser: event listeners plus an idle callback the test runs by hand. */
function fakeBrowser() {
  const listeners = new Map<string, Set<Listener>>()
  const idle: (() => void)[] = []
  const window = {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener)
    }),
    requestIdleCallback: vi.fn((callback: () => void) => idle.push(callback)),
  }
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', { readyState: 'complete' })
  return {
    window,
    dispatch: (type: string, event: unknown) => listeners.get(type)?.forEach(fn => fn(event)),
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    runIdle: () => idle.splice(0).forEach(fn => fn()),
  }
}

async function load(dsn: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)
  vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', 'commit-sha')
  return import('./error-reporting')
}

/** Lets the dynamic import and its `then` callbacks settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('error reporting', () => {
  beforeEach(() => {
    mocks.initSentry.mockReturnValue(mocks.capture)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does nothing at all without a DSN: no listeners, no SDK, no reports', async () => {
    const browser = fakeBrowser()
    const reporting = await load('')
    reporting.startErrorReporting()
    reporting.reportError(new Error('boom'), { source: 'error-boundary' })
    await settle()
    expect(browser.window.addEventListener).not.toHaveBeenCalled()
    expect(browser.window.requestIdleCallback).not.toHaveBeenCalled()
    expect(mocks.loaded).not.toHaveBeenCalled()
    expect(mocks.initSentry).not.toHaveBeenCalled()
  })

  it('loads the SDK only once the page is idle, then hands over the early errors', async () => {
    const browser = fakeBrowser()
    const reporting = await load(DSN)
    reporting.startErrorReporting()
    reporting.startErrorReporting()
    expect(browser.listenerCount('error')).toBe(1)
    expect(mocks.loaded).not.toHaveBeenCalled()

    const early = new Error('before Sentry')
    browser.dispatch('error', { error: early })
    browser.dispatch('unhandledrejection', { reason: 'rejected' })

    browser.runIdle()
    await settle()
    expect(mocks.initSentry).toHaveBeenCalledExactlyOnceWith(DSN, 'commit-sha')
    expect(mocks.capture).toHaveBeenCalledWith(early, { tags: { source: 'early-onerror' } })
    expect(mocks.capture).toHaveBeenCalledWith('rejected', {
      tags: { source: 'early-unhandledrejection' },
    })
    // Sentry's own global handlers take over.
    expect(browser.listenerCount('error')).toBe(0)
    expect(browser.listenerCount('unhandledrejection')).toBe(0)
  })

  it('keeps at most ten early errors', async () => {
    const browser = fakeBrowser()
    const reporting = await load(DSN)
    reporting.startErrorReporting()
    for (let i = 0; i < 25; i++) browser.dispatch('error', { message: `error ${i}` })
    browser.runIdle()
    await settle()
    expect(mocks.capture).toHaveBeenCalledTimes(10)
  })

  it('loads the SDK right away for an error a boundary caught, with its context', async () => {
    fakeBrowser()
    const reporting = await load(DSN)
    const error = new Error('render failed')
    reporting.reportError(error, {
      source: 'error-boundary',
      label: 'the dashboard',
      componentStack: '\n    at Dashboard',
    })
    await settle()
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { source: 'error-boundary' },
      extra: { label: 'the dashboard' },
      contexts: { react: { componentStack: '\n    at Dashboard' } },
    })
  })

  it('stays quiet when the SDK cannot load or start', async () => {
    fakeBrowser()
    const reporting = await load(DSN)
    mocks.initSentry.mockImplementation(() => {
      throw new Error('init failed')
    })
    reporting.reportError(new Error('x'), { source: 'global-error' })
    await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('reports the errors it catches with its label and component stack', async () => {
    fakeBrowser()
    mocks.initSentry.mockReturnValue(mocks.capture)
    await load(DSN)
    const { default: ErrorBoundary } = await import('@/components/ErrorBoundary')
    const boundary = new ErrorBoundary({ children: null, label: 'the calendar' })
    const error = new Error('bad payload')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    boundary.componentDidCatch(error, { componentStack: '\n    at CalendarView' })
    await settle()
    expect(consoleError).toHaveBeenCalled()
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { source: 'error-boundary' },
      extra: { label: 'the calendar' },
      contexts: { react: { componentStack: '\n    at CalendarView' } },
    })
  })
})
