// The device's language on a signed-in account (ROADMAP item 46): while the account's
// choice is Automatic, the server writes its pushes, alerts and calendar feed in
// `deviceLanguage` (packages/core/src/server-language.ts). Loaded only for a signed-in
// account (components/App.tsx), so a guest's first load never carries it.
import { localeFromLanguages, type Locale } from '@solara/core/i18n'
import { isWritablePreferences, type UserPreferences } from '@solara/core/prefs'
import { loadFirebase } from './firebase'

/**
 * The device's language to save to a signed-in account, or null when there is nothing to
 * write (ROADMAP item 46). While the account's choice is Automatic, the server writes its
 * pushes, alerts and calendar feed in `deviceLanguage` (packages/core/src/server-language.ts),
 * so the app keeps it to the language it resolves from this device: a language Solara
 * speaks, never the device's own list. It is written only when it changes, so with
 * devices in two languages the last one to open the app wins. A language chosen in
 * Settings leaves it alone, since the server then writes in that one, and a document a
 * newer Solara wrote is never written by this one (isWritablePreferences).
 */
export function deviceLanguageToSave(
  prefs: Pick<UserPreferences, 'language' | 'deviceLanguage' | 'schemaVersion'>,
  languages: readonly string[] | null | undefined,
): Locale | null {
  if (!isWritablePreferences(prefs)) return null
  if (prefs.language && prefs.language !== 'auto') return null
  const device = localeFromLanguages(languages)
  return prefs.deviceLanguage === device ? null : device
}

/**
 * Saves the language the app resolved from this device to the account (`deviceLanguage`,
 * deviceLanguageToSave), the one field alone, so nothing else on the account
 * is written over.
 */
export async function saveDeviceLanguage(uid: string, deviceLanguage: Locale): Promise<void> {
  const db = (await loadFirebase())?.db
  if (!db) return
  const { doc, updateDoc } = await import('firebase/firestore')
  await updateDoc(doc(db, 'users', uid), { deviceLanguage })
}
