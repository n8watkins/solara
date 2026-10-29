// Sharing to the installed app as Android's share sheet does it (the manifest's
// share_target), for tests/e2e/share-target.spec.ts and the signed-in suite's
// share-target.e2e.ts.
import type { Page } from '@playwright/test'

/** Two upcoming events on the frozen clock (Monday 2026-06-15, 10:30 in Los Angeles). */
export const INVITE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Solara e2e//Share//EN',
  'BEGIN:VEVENT',
  'UID:10k-2026@race.example',
  'DTSTART;TZID=America/Los_Angeles:20260616T090000',
  'DTEND;TZID=America/Los_Angeles:20260616T103000',
  'SUMMARY:Tuesday 10K',
  'LOCATION:Griffith Park',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:picnic@friends.example',
  'DTSTART:20260617T190000Z',
  'DTEND:20260617T203000Z',
  'SUMMARY:Picnic',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

export interface SharedFile {
  name: string
  type: string
  text?: string
  /** A file of this many bytes instead of `text`. */
  bytes?: number
}

/**
 * Sends what Android's share sheet sends for the manifest's share_target: a top-level
 * POST navigation with multipart form data (files in `calendar`, links in `url`/`text`).
 */
export async function share(
  page: Page,
  { file, fields = {} }: { file?: SharedFile; fields?: Record<string, string> },
) {
  await page.evaluate(
    ({ file, fields }) => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.enctype = 'multipart/form-data'
      form.action = '/app/share-target/'
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = value
        form.append(input)
      }
      if (file) {
        const input = document.createElement('input')
        input.type = 'file'
        input.name = 'calendar'
        const body = file.bytes ? new Uint8Array(file.bytes).fill(65) : file.text
        const transfer = new DataTransfer()
        transfer.items.add(new File([body ?? ''], file.name, { type: file.type }))
        input.files = transfer.files
        form.append(input)
      }
      document.body.append(form)
      form.submit()
    },
    { file, fields },
  )
}

export const sharedCard = (page: Page) => page.getByRole('region', { name: /Shared with Solara/ })
