import { describe, expect, it } from 'vitest'
import { currentLocale, intlTag } from './i18n'
import { reapplyReminderMessage } from './reapply'
import { accountLocale, inAccountLanguage } from './server-language'
import { uvAlertMessage } from './alerts'

describe('the account language on the server', () => {
  it('writes in the chosen language, else the device language, else English', () => {
    // A language chosen in Settings wins over the device's.
    expect(accountLocale({ language: 'es' })).toBe('es')
    expect(accountLocale({ language: 'es', deviceLanguage: 'en' })).toBe('es')
    expect(accountLocale({ language: 'en', deviceLanguage: 'es' })).toBe('en')
    // Automatic (or never set) follows the language the app resolved from the device.
    expect(accountLocale({ language: 'auto', deviceLanguage: 'es' })).toBe('es')
    expect(accountLocale({ deviceLanguage: 'es' })).toBe('es')
    expect(accountLocale({ language: 'auto', deviceLanguage: 'en' })).toBe('en')
    // Without either, or with values the server does not know, English.
    for (const value of ['auto', undefined, null, 'fr', 7]) {
      expect(accountLocale({ language: value })).toBe('en')
      expect(accountLocale({ language: 'auto', deviceLanguage: value })).toBe('en')
    }
    expect(accountLocale({ language: 'fr', deviceLanguage: 'es' })).toBe('es')
    expect(accountLocale({ deviceLanguage: 'es-MX' })).toBe('en')
    expect(accountLocale(undefined)).toBe('en')
    expect(accountLocale(null)).toBe('en')
  })

  it('builds the text in the language and restores English after, even on a throw', () => {
    expect(inAccountLanguage({ language: 'es' }, () => reapplyReminderMessage('water').title)).toBe(
      'Es hora de volver a aplicar protector solar',
    )
    expect(currentLocale()).toBe('en')
    expect(intlTag()).toBe('en-US')
    expect(() =>
      inAccountLanguage({ language: 'es' }, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(currentLocale()).toBe('en')
    expect(reapplyReminderMessage('water').title).toBe('Time to reapply sunscreen')
  })

  it('writes a 24-hour clock and a place without a name in Spanish', () => {
    const plan = { threshold: 8, from: 11.5, to: 15, peak: { uv: 9.4, hour: 13 } }
    const message = inAccountLanguage({ language: 'auto', deviceLanguage: 'es' }, () =>
      uvAlertMessage({ plan, city: ' ', localHour: 12, clock: '24h' }),
    )
    expect(message).toEqual({
      title: '☀️ El UV ya está en 8 o más',
      body: 'Pronóstico para tu zona: UV de 8 o más hasta cerca de las 15:00, con un máximo de 9.4 hacia las 13:00. Planifica sombra y protección solar, y vuelve a revisar las condiciones actuales.',
    })
  })
})
