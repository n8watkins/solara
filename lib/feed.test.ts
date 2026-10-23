import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  appCheckToken: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  onSnapshot: mocks.onSnapshot,
}))

vi.mock('@/lib/firebase', () => ({
  db: { kind: 'test-db' },
  appCheckConfigured: () => !!process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY,
  appCheckToken: mocks.appCheckToken,
}))

import {
  buildFeedUrl,
  buildWebcalUrl,
  isFeedConfigured,
  revokeFeedToken,
  rotateFeedToken,
  watchFeedToken,
} from '@/lib/feed'

const TOKEN = 'A'.repeat(43)
const user = { getIdToken: vi.fn().mockResolvedValue('id-token') }

describe('feed helpers (unconfigured env)', () => {
  it('reports not configured and builds no URLs', () => {
    expect(isFeedConfigured()).toBe(false)
    expect(buildFeedUrl(TOKEN)).toBeNull()
    expect(buildWebcalUrl(TOKEN)).toBeNull()
  })
})

describe('server-minted feed tokens', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', 'https://functions.example.test/')
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY', 'site-key')
    mocks.appCheckToken.mockResolvedValue('app-check')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    mocks.onSnapshot.mockReset()
  })

  it('builds https and webcal subscribe URLs', () => {
    expect(isFeedConfigured()).toBe(true)
    expect(buildFeedUrl(TOKEN)).toBe(`https://functions.example.test/calendarFeed?token=${TOKEN}`)
    expect(buildWebcalUrl(TOKEN)).toBe(
      `webcal://functions.example.test/calendarFeed?token=${TOKEN}`,
    )
  })

  it('asks the server to mint a token and never sends one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: TOKEN }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(rotateFeedToken(user as never)).resolves.toBe(TOKEN)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://functions.example.test/rotateCalendarFeed',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({
          Authorization: 'Bearer id-token',
          'X-Firebase-AppCheck': 'app-check',
        }),
      }),
    )
  })

  it('rejects a malformed token from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'short' }) }),
    )
    await expect(rotateFeedToken(user as never)).rejects.toThrow('Could not create a feed link')
  })

  it('revokes the feed with DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revoked: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await revokeFeedToken(user as never)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://functions.example.test/revokeCalendarFeed',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('follows the owner-readable token document', () => {
    const states: unknown[] = []
    mocks.onSnapshot.mockImplementation((ref: { path: string }, next: (s: unknown) => void) => {
      expect(ref.path).toBe('users/user-1/private/calendarFeed')
      next({ exists: () => true, get: () => TOKEN })
      next({ exists: () => false, get: () => undefined })
      next({ exists: () => true, get: () => 'not a token!' })
      return () => {}
    })
    watchFeedToken('user-1', state => states.push(state), vi.fn())
    expect(states).toEqual([
      { status: 'loading' },
      { status: 'ready', token: TOKEN },
      { status: 'ready', token: null },
      { status: 'ready', token: null },
    ])
  })
})
