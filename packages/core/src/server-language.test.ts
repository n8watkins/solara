import { describe, expect, it } from 'vitest'
import { currentLocale, intlTag } from './i18n'
import { reapplyReminderMessage } from './reapply'
import { accountLocale, inAccountLanguage } from './server-language'
import { uvAlertMessage } from './alerts'

describe('the account language on the server', () => {
  it('writes Spanish only for a Spanish account, English otherwise', () => {
    expect(accountLocale('es')).toBe('es')
    for (const value of ['en', 'auto', undefined, null, 'fr', 7]) {
      expect(accountLocale(value)).toBe('en')
    }
  })

  it('builds the text in the language and restores English after, even on a throw', () => {
    expect(inAccountLanguage('es', () => reapplyReminderMessage('water').title)).toBe(
      'Es hora de volver a aplicar protector solar',
    )
    expect(currentLocale()).toBe('en')
    expect(intlTag()).toBe('en-US')
    expect(() =>
      inAccountLanguage('es', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(currentLocale()).toBe('en')
    expect(reapplyReminderMessage('water').title).toBe('Time to reapply sunscreen')
  })

  it('writes a 24-hour clock and a place without a name in Spanish', () => {
    const plan = { threshold: 8, from: 11.5, to: 15, peak: { uv: 9.4, hour: 13 } }
    const message = inAccountLanguage('es', () =>
      uvAlertMessage({ plan, city: ' ', localHour: 12, clock: '24h' }),
    )
    expect(message).toEqual({
      title: '☀️ El UV ya está en 8 o más',
      body: 'Pronóstico para tu zona: UV de 8 o más hasta cerca de las 15:00, con un máximo de 9.4 hacia las 13:00. Planifica sombra y protección solar, y vuelve a revisar las condiciones actuales.',
    })
  })
})
