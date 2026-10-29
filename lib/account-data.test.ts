import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accountControlsPath,
  capitalized,
  DATA_REQUEST_EMAIL,
  DELETED_DATA,
  DELETION_NOTES,
  DELETION_SUMMARY,
  EXPORT_EXCLUDED,
  EXPORT_SECTIONS,
  EXPORT_SUMMARY,
  exportedMessage,
  listInWords,
} from './account-data'

describe('account data copy', () => {
  it('names every export section, imported events included, and what is left out', () => {
    expect(Object.values(EXPORT_SECTIONS)).toContain('your imported events')
    expect(EXPORT_SUMMARY).toBe('Get a copy of your Solara data as a JSON file.')
    expect(EXPORT_EXCLUDED).toContain('calendar feed address')
    expect(EXPORT_EXCLUDED).toContain('payment-provider identifiers')
  })

  it('says deletion removes imported events and the calendar feed, and what stays', () => {
    expect(DELETION_SUMMARY).toMatch(/^Permanently deletes your account/)
    expect(DELETED_DATA).toContain('imported events')
    expect(DELETED_DATA).toContain('your calendar feed')
    expect(DELETED_DATA).toContain('your Google Calendar choices')
    expect(DELETED_DATA).toContain('your Outlook calendar choices')
    expect(DELETED_DATA.at(-1)).toBe('your Solara sign-in')
    const notes = DELETION_NOTES.join(' ')
    expect(notes).toContain('without a refund for the current period')
    expect(notes).toContain('Google Calendar stay there')
    expect(notes).toContain('myaccount.google.com/connections')
    expect(notes).toContain('Microsoft account’s app permissions')
    expect(notes).toContain('kept for 2 years')
  })

  it('starts each listed item with a capital', () => {
    expect(capitalized('your imported events')).toBe('Your imported events')
    expect(capitalized('')).toBe('')
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
