import { describe, expect, it } from 'vitest'

import {
  DELETION_DESCRIPTION,
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
    expect(DELETION_DESCRIPTION).toContain('imported events')
    expect(DELETION_DESCRIPTION).toContain('your calendar feed')
    expect(DELETION_DESCRIPTION).toContain('Google Calendar stay there')
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
