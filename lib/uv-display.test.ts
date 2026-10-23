import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadICS } from '@/lib/ics'
import { fmtClock, fmtDays, gcalLink, uvColorHex, uvTextHex } from '@/lib/weather'

// The UV scale bands drive every UV color in the app; a band edge that drifts
// shows a high UV hour in a "low" color.
const BAND_SAMPLES = [0, 1, 4, 6, 9, 11]

describe('UV color bands', () => {
  it('gives each band its own background and text color', () => {
    expect(BAND_SAMPLES.map(uvColorHex)).toEqual([
      '#D1D5DB',
      '#86EFAC',
      '#FCD34D',
      '#FB923C',
      '#F87171',
      '#C084FC',
    ])
    expect(BAND_SAMPLES.map(uvTextHex)).toEqual([
      '#374151',
      '#14532D',
      '#78350F',
      '#7C2D12',
      '#7F1D1D',
      '#4A044E',
    ])
  })

  it('puts band edges on the low side of each boundary', () => {
    expect([0.49, 0.5, 2, 2.1, 5, 7, 10, 10.1].map(uvColorHex)).toEqual([
      '#D1D5DB',
      '#86EFAC',
      '#86EFAC',
      '#FCD34D',
      '#FCD34D',
      '#FB923C',
      '#F87171',
      '#C084FC',
    ])
  })
})

describe('time and day formatting', () => {
  it('formats fractional hours, rolling :60 over', () => {
    expect(fmtClock(6.75)).toBe('6:45am')
    expect(fmtClock(17)).toBe('5pm')
    expect(fmtClock(11.999)).toBe('12pm')
    expect(fmtClock(12.5)).toBe('12:30pm')
  })

  it('summarizes weekday restrictions', () => {
    expect(fmtDays(undefined)).toBeNull()
    expect(fmtDays([0, 1, 2, 3, 4, 5, 6])).toBeNull()
    expect(fmtDays([5, 1, 2, 3, 4])).toBe('Weekdays')
    expect(fmtDays([6, 0])).toBe('Weekends')
    expect(fmtDays([3, 1])).toBe('Mon, Wed')
  })

  it('builds a Google Calendar link for a lower-UV window', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15, 8))
    const link = new URL(gcalLink('Walk', { from: 7, to: 9 }, 30, 1))
    vi.useRealTimers()
    expect(link.searchParams.get('text')).toBe('Walk: lower-UV window')
    const [start, end] = link.searchParams.get('dates')!.split('/')
    expect(start).toBe(
      new Date(2026, 5, 16, 7).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    )
    expect(end).toBe(
      new Date(2026, 5, 16, 7, 30).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    )
  })
})

describe('downloadICS', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a no-op outside the browser', () => {
    expect(() => downloadICS('plan.ics', 'BEGIN:VCALENDAR')).not.toThrow()
  })

  it('downloads the calendar as a text/calendar file and releases the URL', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:solara')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadICS('plan.ics', 'BEGIN:VCALENDAR')

    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/calendar;charset=utf-8')
    expect(await blob.text()).toBe('BEGIN:VCALENDAR')
    expect(anchor).toMatchObject({ href: 'blob:solara', download: 'plan.ics' })
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:solara')
  })
})
