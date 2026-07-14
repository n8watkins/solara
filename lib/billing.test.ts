import { afterEach, describe, expect, it, vi } from 'vitest'

async function freshBilling() {
  vi.resetModules()
  return import('@/lib/billing')
}

describe('authenticated checkout', () => {
  const original = process.env.NEXT_PUBLIC_FUNCTIONS_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = original
    vi.unstubAllGlobals()
  })

  it('reports unconfigured when the Functions URL is absent', async () => {
    delete process.env.NEXT_PUBLIC_FUNCTIONS_URL
    const { createCheckoutUrl, isCheckoutConfigured } = await freshBilling()
    expect(isCheckoutConfigured()).toBe(false)
    await expect(createCheckoutUrl({ getIdToken: vi.fn() } as never)).rejects.toThrow('not configured')
  })

  it('creates checkout with a freshly issued Firebase ID token', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test/'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay_test' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const getIdToken = vi.fn().mockResolvedValue('firebase-id-token')
    const { createCheckoutUrl, isCheckoutConfigured } = await freshBilling()

    expect(isCheckoutConfigured()).toBe(true)
    await expect(createCheckoutUrl({ getIdToken } as never)).resolves.toBe('https://checkout.stripe.com/c/pay_test')
    expect(getIdToken).toHaveBeenCalledWith(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://functions.example.test/createCheckoutSession',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-id-token' }),
      }),
    )
  })

  it('rejects untrusted checkout URLs returned by the backend', async () => {
    process.env.NEXT_PUBLIC_FUNCTIONS_URL = 'https://functions.example.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://attacker.example/checkout' }),
    }))
    const { createCheckoutUrl } = await freshBilling()
    await expect(createCheckoutUrl({ getIdToken: vi.fn().mockResolvedValue('token') } as never)).rejects.toThrow('unavailable')
  })
})
