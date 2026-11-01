// The 12-hour clock in the active language: "9am", "6:45am" in English, "9 a.m." in
// Spanish. Every 12-hour time in the app, the alerts and the calendar feed is written here.
import m from './messages/core'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A 12-hour time from fractional hours: "12am", "6:45am", "12pm". 24 reads as midnight. */
export function formatClock12(hours: number): string {
  const total = Math.round(hours * 60)
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return m.clock12(`${h12}${minute ? `:${pad2(minute)}` : ''}`, hour >= 12)
}

/** The narrowest 12-hour label, for the hourly strip: "6a", "12p", "6:30a". */
export function formatClock12Compact(hours: number): string {
  const total = Math.round(hours * 60)
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return m.clock12Compact(`${h12}${minute ? `:${pad2(minute)}` : ''}`, hour >= 12)
}
