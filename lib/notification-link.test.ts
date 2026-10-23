import { describe, expect, it } from 'vitest'
import { chooseWindowClient, safeNotificationUrl } from './notification-link'

const ORIGIN = 'https://solara.test'

describe('safeNotificationUrl', () => {
  it('keeps same-origin links, relative or absolute', () => {
    expect(safeNotificationUrl('/?tab=today', ORIGIN)).toBe('https://solara.test/?tab=today')
    expect(safeNotificationUrl('https://solara.test/share/', ORIGIN)).toBe(
      'https://solara.test/share/',
    )
  })

  it('sends anything else to the home page', () => {
    for (const link of [
      'https://evil.example/login',
      '//evil.example/login',
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://solara.test/', // different origin: scheme differs
      '',
      undefined,
      42,
    ]) {
      expect(safeNotificationUrl(link, ORIGIN)).toBe('https://solara.test/')
    }
  })
})

describe('chooseWindowClient', () => {
  it('prefers a window already on the target, then any app window', () => {
    const urls = ['https://other.test/', 'https://solara.test/privacy/', 'https://solara.test/']
    expect(chooseWindowClient(urls, 'https://solara.test/', ORIGIN)).toBe(2)
    expect(chooseWindowClient(urls, 'https://solara.test/share/', ORIGIN)).toBe(1)
    expect(chooseWindowClient(['https://other.test/'], 'https://solara.test/', ORIGIN)).toBe(-1)
  })
})
