import { describe, expect, it } from 'vitest'
import {
  clearAnalyticsCookies,
  cookieDomains,
  gtagConfig,
  isAnalyticsCookie,
  stripQuery,
} from './ga'

describe('stripQuery', () => {
  it('drops query strings and fragments', () => {
    expect(stripQuery('https://solara.test/share/?a=Run&session_id=abc#x')).toBe(
      'https://solara.test/share/',
    )
    expect(stripQuery('')).toBe('')
    expect(stripQuery('not a url')).toBe('')
  })
})

describe('gtagConfig', () => {
  it('sends no query strings and turns signals off', () => {
    expect(
      gtagConfig('https://solara.test/?session_id=abc', 'https://ref.test/p?q=secret'),
    ).toEqual({
      page_location: 'https://solara.test/',
      page_referrer: 'https://ref.test/p',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    })
  })
})

describe('analytics cookies', () => {
  it('recognizes only GA cookie names', () => {
    expect(['_ga', '_ga_ABC123', '_gid', '_gat_UA-1'].every(isAnalyticsCookie)).toBe(true)
    expect(['solara', 'ga', '__session', '_gab'].some(isAnalyticsCookie)).toBe(false)
  })

  it('lists parent domains but never a bare IP', () => {
    expect(cookieDomains('solara-uv.web.app')).toEqual(['solara-uv.web.app', 'web.app'])
    expect(cookieDomains('127.0.0.1')).toEqual(['127.0.0.1'])
    expect(cookieDomains('localhost')).toEqual(['localhost'])
  })

  it('expires each analytics cookie on every candidate domain', () => {
    const writes: string[] = []
    const doc = {
      get cookie() {
        return '_ga=GA1.1.1; theme=dark; _ga_TEST123=GS1.1; _gid=GA1.2'
      },
      set cookie(value: string) {
        writes.push(value)
      },
    }

    expect(clearAnalyticsCookies(doc, 'app.example.com')).toEqual(['_ga', '_ga_TEST123', '_gid'])
    expect(writes.every(w => /max-age=0/.test(w))).toBe(true)
    expect(writes.some(w => w.startsWith('theme='))).toBe(false)
    expect(writes).toContain(
      '_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/; domain=.example.com',
    )
  })
})
