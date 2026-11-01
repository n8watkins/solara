// The device's language kept on a signed-in account on Automatic (lib/device-language.ts).
import { describe, expect, it } from 'vitest'
import { PREFS_SCHEMA_VERSION } from '@solara/core/prefs'
import { deviceLanguageToSave } from './device-language'

describe('deviceLanguageToSave', () => {
  const V = PREFS_SCHEMA_VERSION

  it("keeps an Automatic account's device language to the one this device resolves", () => {
    // A Spanish device on an account that has none yet, or another device's English.
    expect(deviceLanguageToSave({ schemaVersion: V, language: 'auto' }, ['es-MX', 'en'])).toBe('es')
    expect(deviceLanguageToSave({ schemaVersion: V }, ['es-MX'])).toBe('es')
    expect(
      deviceLanguageToSave({ schemaVersion: V, language: 'auto', deviceLanguage: 'en' }, ['es-AR']),
    ).toBe('es')
    // A supported language only, never the device's list: French and German read as English.
    expect(
      deviceLanguageToSave({ schemaVersion: V, language: 'auto', deviceLanguage: 'es' }, [
        'fr-FR',
        'de',
      ]),
    ).toBe('en')
    expect(deviceLanguageToSave({ schemaVersion: V, language: 'auto' }, [])).toBe('en')
  })

  it('writes nothing when it is unchanged or a language is chosen in Settings', () => {
    expect(
      deviceLanguageToSave({ schemaVersion: V, language: 'auto', deviceLanguage: 'es' }, ['es-MX']),
    ).toBeNull()
    expect(deviceLanguageToSave({ schemaVersion: V, deviceLanguage: 'en' }, ['en-GB'])).toBeNull()
    expect(deviceLanguageToSave({ schemaVersion: V, language: 'en' }, ['es-MX'])).toBeNull()
    expect(
      deviceLanguageToSave({ schemaVersion: V, language: 'es', deviceLanguage: 'en' }, ['es-MX']),
    ).toBeNull()
    // A document from a newer Solara is never written by this one.
    expect(deviceLanguageToSave({ schemaVersion: V + 1 }, ['es-MX'])).toBeNull()
  })
})
