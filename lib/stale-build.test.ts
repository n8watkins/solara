import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RELOAD_GUARD_MS,
  UPDATE_RELOAD_KEY,
  codeIsGone,
  failedCodeUrl,
  recoverFromStaleBuild,
  resetUpdateNoticeForTests,
  takeUpdateNotice,
} from './stale-build'

// REVIEW10 VERIFY10 N2: a page left open across a deploy.

const ORIGIN = 'https://solara-uv.web.app'
const CHUNK = `${ORIGIN}/_next/static/chunks/0abc123.js`

describe('failedCodeUrl', () => {
  it("reads the file from each bundler's and browser's message", () => {
    for (const message of [
      'Failed to load chunk /_next/static/chunks/0abc123.js from module 12345',
      'Loading chunk 123 failed.\n(error: https://solara-uv.web.app/_next/static/chunks/0abc123.js)',
      'Failed to fetch dynamically imported module: https://solara-uv.web.app/_next/static/chunks/0abc123.js',
    ]) {
      expect(failedCodeUrl(new Error(message), ORIGIN)).toBe(CHUNK)
    }
  })

  it('looks into the cause, and ignores other errors and other sites', () => {
    const wrapped = new Error('Could not load', {
      cause: new Error(`Failed to load chunk ${CHUNK}`),
    })
    expect(failedCodeUrl(wrapped, ORIGIN)).toBe(CHUNK)
    expect(failedCodeUrl(new Error('auth/network-request-failed'), ORIGIN)).toBeNull()
    expect(
      failedCodeUrl(
        new Error('Failed to load chunk https://evil.example/_next/static/x.js'),
        ORIGIN,
      ),
    ).toBeNull()
    expect(failedCodeUrl(null, ORIGIN)).toBeNull()
    expect(failedCodeUrl('a string', ORIGIN)).toBeNull()
  })
})

describe('codeIsGone', () => {
  it('is true only when the server says the file is gone, asking past every cache', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    expect(await codeIsGone(CHUNK, fetchImpl)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(CHUNK, { method: 'HEAD', cache: 'no-store' })
    expect(await codeIsGone(CHUNK, async () => new Response(null, { status: 200 }))).toBe(false)
    expect(await codeIsGone(CHUNK, async () => new Response(null, { status: 503 }))).toBe(false)
    expect(
      await codeIsGone(CHUNK, async () => Promise.reject(new TypeError('Failed to fetch'))),
    ).toBe(false)
  })
})

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

describe('recoverFromStaleBuild', () => {
  const stale = new Error(`Failed to load chunk ${CHUNK}`)
  const gone = async () => new Response(null, { status: 404 })
  let storage: ReturnType<typeof memoryStorage>
  let reload: ReturnType<typeof vi.fn<() => void>>
  const env = (over: object = {}) => ({
    origin: ORIGIN,
    online: true,
    storage,
    reload,
    now: 1_000_000,
    fetchImpl: gone,
    ...over,
  })

  beforeEach(() => {
    storage = memoryStorage()
    reload = vi.fn<() => void>()
    resetUpdateNoticeForTests()
  })

  it('reloads once when the code is gone, remembering why', async () => {
    expect(await recoverFromStaleBuild(stale, 'sign-in', env())).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
    expect(JSON.parse(storage.map.get(UPDATE_RELOAD_KEY)!)).toEqual({
      at: 1_000_000,
      reason: 'sign-in',
    })
    // The same failure right after the reload does not reload again.
    expect(await recoverFromStaleBuild(stale, 'sign-in', env({ now: 1_030_000 }))).toBe('updated')
    expect(reload).toHaveBeenCalledOnce()
    // Much later (another deploy), it may.
    const later = env({ now: 1_000_000 + RELOAD_GUARD_MS + 1 })
    expect(await recoverFromStaleBuild(stale, 'open', later)).toBe('reloading')
  })

  it('never reloads offline, when the file is still there, or for other errors', async () => {
    expect(await recoverFromStaleBuild(stale, 'open', env({ online: false }))).toBe('not-stale')
    const there = async () => new Response('', { status: 200 })
    expect(await recoverFromStaleBuild(stale, 'open', env({ fetchImpl: there }))).toBe('not-stale')
    expect(await recoverFromStaleBuild(new Error('popup closed'), 'open', env())).toBe('not-stale')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload without sessionStorage, which guards against a loop', async () => {
    expect(await recoverFromStaleBuild(stale, 'open', env({ storage: null }))).toBe('updated')
    expect(reload).not.toHaveBeenCalled()
  })

  it('tells the reloaded page why, once', async () => {
    await recoverFromStaleBuild(stale, 'sign-in', env())
    expect(takeUpdateNotice({ storage, now: 1_002_000 })).toBe('sign-in')
    // The same page asking again (a second render) gets the same answer.
    expect(takeUpdateNotice({ storage, now: 1_002_500 })).toBe('sign-in')
    // The next page load does not.
    resetUpdateNoticeForTests()
    expect(takeUpdateNotice({ storage, now: 1_003_000 })).toBeNull()
  })

  it('shows nothing on an ordinary load', () => {
    expect(takeUpdateNotice({ storage, now: 1 })).toBeNull()
  })
})
