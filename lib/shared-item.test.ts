import { describe, expect, it } from 'vitest'
import { parseIcs } from '@solara/core/event-import'
import { readErrorMessage, readIcsFile } from './events'
import { SHARE_CACHE, SHARE_KEEP_MS, SHARE_TARGET_PATH, receiveShare } from './share-target'
import { fakeCaches } from '../tests/fake-caches'
import {
  clearSharedItem,
  loadSharedItem,
  previewEvents,
  previewHeadline,
  refusalMessage,
  sharedLinkKind,
} from './shared-item'
import type { Location } from './types'

const ORIGIN = 'https://solara-uv.web.app'
// Monday 2026-06-15, 10:30 in Los Angeles.
const NOW = Date.UTC(2026, 5, 15, 17, 30)
const ID = '0123456789abcdef'
const HOME: Location = {
  lat: 34.05,
  lon: -118.24,
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
}

const INVITE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:10k@race.example',
  'DTSTART;TZID=America/Los_Angeles:20260616T090000',
  'DTEND;TZID=America/Los_Angeles:20260616T103000',
  'SUMMARY:Tuesday 10K',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:picnic@friends.example',
  'DTSTART:20260617T190000Z',
  'DTEND:20260617T203000Z',
  'SUMMARY:Picnic',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:camp@friends.example',
  'DTSTART;TZID=America/Los_Angeles:20260620T180000',
  'DTEND;TZID=America/Los_Angeles:20260621T100000',
  'SUMMARY:',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:swim@friends.example',
  'DTSTART;TZID=America/Los_Angeles:20260622T080000',
  'DTEND;TZID=America/Los_Angeles:20260622T090000',
  'SUMMARY:Swim',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

async function share(
  storage: ReturnType<typeof fakeCaches>,
  entries: Record<string, string | File>,
) {
  const form = new FormData()
  for (const [name, value] of Object.entries(entries)) form.append(name, value)
  const encoded = new Response(form)
  const request = new Request(`${ORIGIN}${SHARE_TARGET_PATH}`, {
    method: 'POST',
    headers: { 'content-type': encoded.headers.get('content-type')! },
    body: await encoded.arrayBuffer(),
  })
  return receiveShare(request, ORIGIN, storage, NOW, ID)
}

const time = (hours: number) => {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}

describe('the hand-off from the worker to the import', () => {
  it('reads the shared file the worker kept and parses it like a picked file', async () => {
    const storage = fakeCaches()
    await share(storage, {
      calendar: new File([INVITE], 'invite.ics', { type: 'text/calendar' }),
    })
    const item = await loadSharedItem(ID, NOW + 60_000, storage)
    expect(item).toMatchObject({ kind: 'file', name: 'invite.ics' })
    if (item.kind !== 'file') throw new Error('expected a file')
    expect(item.file.size).toBe(new TextEncoder().encode(INVITE).byteLength)

    const result = await readIcsFile(item.file, {
      home: HOME,
      nowMs: NOW,
      parse: async (text, options) => parseIcs(text, options),
    })
    expect(result.events.map(event => event.title)).toEqual(['Tuesday 10K', 'Picnic', '', 'Swim'])
    expect(previewHeadline(item.name, result.events.length)).toBe(
      'invite.ics has 4 upcoming events.',
    )
    expect(previewEvents(result, NOW, 'America/Los_Angeles', time)).toEqual([
      { title: 'Tuesday 10K', when: 'Tomorrow · 9am – 10:30am' },
      { title: 'Picnic', when: 'Wed, Jun 17 · 12pm – 1:30pm' },
      { title: 'Untitled event', when: 'Sat, Jun 20 · 6pm – Sun, Jun 21 10am' },
    ])
  })

  it('hands over links and refusals, and nothing for another id or once expired', async () => {
    const storage = fakeCaches()
    await share(storage, { url: 'webcal://club.example/races.ics' })
    expect(await loadSharedItem(ID, NOW, storage)).toEqual({
      kind: 'link',
      link: 'webcal://club.example/races.ics',
    })
    expect(await loadSharedItem('fedcba9876543210', NOW, storage)).toEqual({ kind: 'none' })
    expect(await loadSharedItem(ID, NOW + SHARE_KEEP_MS + 1, storage)).toEqual({ kind: 'none' })
    // The expired share was removed.
    expect(storage.names()).toEqual([])

    await share(storage, { calendar: new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }) })
    expect(await loadSharedItem(ID, NOW, storage)).toEqual({
      kind: 'refused',
      reason: 'not-calendar',
    })
  })

  it('removes the share once used, and copes without Cache Storage', async () => {
    const storage = fakeCaches()
    await share(storage, { url: 'https://club.example/c.ics' })
    expect(storage.names()).toEqual([SHARE_CACHE])
    await clearSharedItem(storage)
    expect(storage.names()).toEqual([])
    expect(await loadSharedItem(ID, NOW, storage)).toEqual({ kind: 'none' })
    expect(await loadSharedItem(ID, NOW, null)).toEqual({ kind: 'none' })
    await expect(clearSharedItem(null)).resolves.toBeUndefined()
  })

  it('refuses an oversized file before reading it, with the import’s message', async () => {
    let read = false
    const file = {
      size: 2 * 1024 * 1024,
      text: async () => {
        read = true
        return ''
      },
    }
    const error = await readIcsFile(file, { home: HOME, nowMs: NOW }).catch(e => e)
    expect(read).toBe(false)
    expect(readErrorMessage(error)).toBe(
      'That file is larger than 1 MB. Export a shorter range of events.',
    )
  })
})

describe('sharedLinkKind', () => {
  it('knows calendar links', () => {
    expect(sharedLinkKind('webcal://club.example/races')).toBe('calendar')
    expect(sharedLinkKind('https://club.example/races.ics')).toBe('calendar')
    expect(
      sharedLinkKind(
        'https://calendar.google.com/calendar/ical/a%40gmail.com/private-abc123/basic.ics',
      ),
    ).toBe('calendar')
  })

  it('knows web pages', () => {
    expect(sharedLinkKind('https://www.meetup.com/la-hikers/events/123/')).toBe('page')
    expect(sharedLinkKind('https://calendar.google.com/calendar/r')).toBe('page')
  })

  it('leaves a known provider’s unusual link to the form', () => {
    expect(sharedLinkKind('https://calendar.yahoo.com/someone/abc123')).toBe('unknown')
  })
})

describe('copy', () => {
  it('counts events in the headline', () => {
    expect(previewHeadline('a.ics', 1)).toBe('a.ics has 1 upcoming event.')
    expect(previewHeadline('a.ics', 0)).toBe(
      'No upcoming events with a start time were found in a.ics.',
    )
  })

  it('says why a share was refused and what to do', () => {
    expect(refusalMessage('too-large')).toContain('larger than 1 MB')
    expect(refusalMessage('not-calendar')).toContain('calendar (.ics) files only')
    expect(refusalMessage('nothing')).toContain('Nothing came through')
  })
})
