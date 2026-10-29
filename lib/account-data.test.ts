import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accountControlsPath,
  DATA_REQUEST_EMAIL,
  DELETION_DESCRIPTION,
  DELETION_DETAILS,
  EXPORT_DESCRIPTION,
  EXPORT_SECTIONS,
  exportedMessage,
  listInWords,
} from './account-data'

describe('account data copy', () => {
  it('names every export section, imported events included', () => {
    for (const phrase of Object.values(EXPORT_SECTIONS)) {
      expect(EXPORT_DESCRIPTION).toContain(phrase)
    }
    expect(EXPORT_DESCRIPTION).toContain('imported events')
    expect(EXPORT_DESCRIPTION).toMatch(/^The JSON export includes your preferences \(/)
  })

  it('says deletion removes imported events and the calendar feed', () => {
    expect(DELETION_DESCRIPTION).toMatch(/^This permanently removes your Solara preferences/)
    expect(DELETION_DESCRIPTION).toContain('imported events')
    expect(DELETION_DESCRIPTION).toContain('your calendar feed')
    expect(DELETION_DESCRIPTION).toContain('your Google Calendar choices')
    expect(DELETION_DESCRIPTION).toContain('your Outlook calendar choices')
    expect(DELETION_DESCRIPTION).toMatch(/your Solara sign-in\.$/)
    expect(DELETION_DETAILS).toContain('Google Calendar stay there')
    expect(DELETION_DETAILS).toContain('myaccount.google.com/connections')
    expect(DELETION_DETAILS).toContain('Microsoft account’s app permissions')
  })

  it('sends data requests to the operator’s contact address', () => {
    expect(DATA_REQUEST_EMAIL).toBe('contact@n8builds.dev')
  })

  it('joins lists in plain words', () => {
    expect(listInWords([])).toBe('')
    expect(listInWords(['a'])).toBe('a')
    expect(listInWords(['a', 'b'])).toBe('a and b')
    expect(listInWords(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('says when the server cut a section short', () => {
    expect(exportedMessage(undefined)).toBe('Your account data was downloaded.')
    expect(exportedMessage([])).toBe('Your account data was downloaded.')
    expect(exportedMessage(['importedEvents', 'scheduledActivities', 'bogus', 3])).toBe(
      'Your account data was downloaded. It holds the first 5,000 records of imported events and scheduled activities; the privacy policy says how to ask for the rest.',
    )
  })
})

describe('accountControlsPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses the Functions when this build can call them, else this browser', () => {
    expect(accountControlsPath(true)).toBe('functions')
    expect(accountControlsPath(false)).toBe('browser')
  })

  it('lets only an emulator build take the browser path on purpose', () => {
    const store = new Map([['solara-firebase-emulators.functions-off', '1']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null })
    expect(accountControlsPath(true)).toBe('functions')
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATORS', '1')
    expect(accountControlsPath(true)).toBe('browser')
    store.clear()
    expect(accountControlsPath(true)).toBe('functions')
  })
})
