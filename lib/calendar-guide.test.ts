import { describe, expect, it } from 'vitest'
import { CALENDAR_PROVIDERS } from '@solara/core/event-import'
import { CALENDAR_GUIDES, GOOGLE_EVENTS_NOTE, SHARED_NOTES } from './calendar-guide'

// docs/integrations/CALENDAR_LINKS.md, "Tests": one sentence per step, no em dash, under
// 120 characters, so each step reads at a glance on a phone.
const oneSentence = (text: string) => {
  expect(text.length, text).toBeLessThan(120)
  expect(text, text).not.toContain('—')
  expect(text, text).toMatch(/^[A-Z].*[.]$/)
  // A full stop followed by a capital would start a second sentence ("icloud.com/calendar"
  // and "Outlook.com" have no space after the dot).
  expect(text.slice(0, -1), text).not.toMatch(/[.!?]\s/)
}

describe('CALENDAR_GUIDES', () => {
  it('has a guide for every provider, in the order offered', () => {
    expect(Object.keys(CALENDAR_GUIDES)).toEqual([...CALENDAR_PROVIDERS])
  })

  it('writes every step and note as one short sentence', () => {
    for (const guide of Object.values(CALENDAR_GUIDES)) {
      for (const way of guide.ways) way.steps.forEach(oneSentence)
      guide.notes.forEach(oneSentence)
      if (guide.summary) oneSentence(guide.summary)
    }
    Object.values(SHARED_NOTES).forEach(oneSentence)
    oneSentence(GOOGLE_EVENTS_NOTE)
  })

  it('gives numbered steps that end at the link field, or one sentence for Yahoo', () => {
    for (const [provider, guide] of Object.entries(CALENDAR_GUIDES)) {
      if (provider === 'yahoo') {
        // Unconfirmed in Yahoo's own help (CALENDAR_LINKS.md, open questions).
        expect(guide.ways).toEqual([])
        expect(guide.summary).toMatch(/paste it below\.$/)
        continue
      }
      expect(guide.summary).toBeNull()
      expect(guide.ways.length).toBeGreaterThan(0)
      for (const way of guide.ways) expect(way.steps.at(-1)).toBe('Paste the link below.')
      // Several ways are told apart by their titles.
      if (guide.ways.length > 1) expect(guide.ways.every(way => way.title)).toBe(true)
    }
  })

  it('says how to stop sharing or reset the link for every provider', () => {
    for (const guide of Object.values(CALENDAR_GUIDES)) {
      expect(guide.notes.some(note => /stop sharing|Reset|Unpublish/.test(note))).toBe(true)
    }
  })

  it('promises no faster refresh than the server', () => {
    expect(SHARED_NOTES.refresh).toBe(
      'Solara checks the link about every 6 hours, so changes can take a few hours to show.',
    )
  })
})
