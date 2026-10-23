import type { User } from 'firebase/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/firebase', () => ({
  appCheckConfigured: () => true,
  appCheckToken: vi.fn(async () => 'app-check'),
}))

import { callFunction, FunctionsApiError } from '@/lib/functions-api'

const user = { getIdToken: vi.fn(async () => 'id-token') } as unknown as User

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }),
  )
}

async function rejection(promise: Promise<unknown>): Promise<FunctionsApiError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof FunctionsApiError)) throw new Error('expected a FunctionsApiError')
  return error
}

const revoke = () =>
  callFunction(user, 'revokeCalendarFeed', { method: 'DELETE', fallbackMessage: 'Try again.' })

describe('callFunction', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_URL', 'https://functions.example.test/'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns a body that matches the endpoint contract', async () => {
    respond(200, { revoked: true })
    await expect(revoke()).resolves.toEqual({ revoked: true })
    expect(fetch).toHaveBeenCalledWith(
      'https://functions.example.test/revokeCalendarFeed',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('rejects a success body that breaks the contract', async () => {
    respond(200, { revoked: 'yes' })
    const error = await rejection(revoke())
    expect(error.message).toBe('Try again.')
    expect(error.code).toBe('invalid-response')
  })

  it('rejects a feed token that is not a valid token', async () => {
    respond(200, { token: 'short' })
    const error = await rejection(
      callFunction(user, 'rotateCalendarFeed', { method: 'POST', fallbackMessage: 'No link.' }),
    )
    expect(error.code).toBe('invalid-response')
  })

  it('reports the server error message and code', async () => {
    respond(429, { error: 'Slow down.', code: 'rate-limited' })
    const error = await rejection(revoke())
    expect(error).toMatchObject({ message: 'Slow down.', status: 429, code: 'rate-limited' })
  })

  it('falls back when an error body is malformed', async () => {
    respond(500, { error: 42, code: ['internal'] })
    const error = await rejection(revoke())
    expect(error).toMatchObject({ message: 'Try again.', status: 500, code: null })
  })
})
