import { describe, expect, it, vi } from 'vitest'
import { MICROSOFT_AUTH_CHANNEL_PREFIX } from './microsoft-auth'
import { MICROSOFT_REDIRECT_SCRIPT } from './microsoft-redirect'

/** Runs the redirect page's script at `url`, with a fake browser around it. */
function run(url: string) {
  const posted: { name: string; data: unknown }[] = []
  const location = new URL(url)
  const replaced: string[] = []
  const close = vi.fn()
  class FakeChannel {
    constructor(readonly name: string) {}
    postMessage(data: unknown) {
      posted.push({ name: this.name, data })
    }
    close() {}
  }
  const history = { replaceState: (_s: unknown, _t: string, path: string) => replaced.push(path) }
  new Function('location', 'history', 'BroadcastChannel', 'window', MICROSOFT_REDIRECT_SCRIPT)(
    location,
    history,
    FakeChannel,
    { close },
  )
  return { posted, replaced, close }
}

describe('the Microsoft redirect page script', () => {
  it('hands the code to the sign-in on its own channel, clears the address bar and closes', () => {
    const { posted, replaced, close } = run(
      'https://solara-uv.web.app/auth/microsoft/?code=M.C5_BAY.2.U&state=abc123&session_state=x',
    )
    expect(posted).toEqual([
      {
        name: `${MICROSOFT_AUTH_CHANNEL_PREFIX}abc123`,
        data: {
          state: 'abc123',
          code: 'M.C5_BAY.2.U',
          error: '',
          errorDescription: '',
          errorSubcode: '',
        },
      },
    ])
    expect(replaced).toEqual(['/auth/microsoft/'])
    expect(close).toHaveBeenCalledOnce()
  })

  it('passes an error on, capped', () => {
    const { posted } = run(
      `https://solara-uv.web.app/auth/microsoft/?error=access_denied&error_subcode=cancel&error_description=${'x'.repeat(900)}&state=s`,
    )
    expect(posted[0]!.data).toMatchObject({
      error: 'access_denied',
      errorSubcode: 'cancel',
      errorDescription: 'x'.repeat(512),
    })
  })

  it('posts nothing without a state, and still closes', () => {
    const { posted, close } = run('https://solara-uv.web.app/auth/microsoft/?code=abc')
    expect(posted).toEqual([])
    expect(close).toHaveBeenCalledOnce()
  })
})
