import { expect, openDashboard, RUNNING, test } from './fixtures'
import type { Page } from './fixtures'

// Linked calendars with "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md,
// ROADMAP item 24) end to end: the real app, the real `eventSubscriptions` Function
// (fetcher, guards and parser included) and the real rules on the emulators. Google's
// calendar server is faked inside the Functions emulator (emulator-calendars.js), so a
// recognised secret address is read without leaving the machine.

// Spelled out as a pattern, so secret scanners do not mistake it for a real token.
const TOKEN = 'MadeUpToken'.repeat(3)
const GOOGLE_SECRET = `webcal://calendar.google.com/calendar/ical/ola.reyes%40gmail.com/private-${TOKEN}/basic.ics`
const OUTLOOK_HTML = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${TOKEN}/cid-0123456789ABCDEF/calendar.html`

function subscriptionCalls(page: Page): string[] {
  const bodies: string[] = []
  page.on('request', request => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/eventSubscriptions')
    ) {
      bodies.push(request.postData() ?? '')
    }
  })
  return bodies
}

test('a recognised Google link goes through the add flow and is named on its card', async ({
  page,
  emulators,
}) => {
  const logged: string[] = []
  page.on('console', message => logged.push(message.text()))
  const calls = subscriptionCalls(page)
  const account = await emulators.createAccount('Ola Reyes')
  await emulators.seedPrefs(account, { activities: [RUNNING] })
  await openDashboard(page, account)

  const panel = page.getByTestId('event-subscriptions')
  await expect(panel.getByText('0 of 5')).toBeVisible()

  // The helper shows Google's steps.
  await panel.getByRole('button', { name: 'Add a calendar from…' }).click()
  await panel.getByRole('radio', { name: 'Google' }).check()
  await expect(panel.getByTestId('add-calendar-steps')).toContainText(
    'Copy the Secret address in iCal format.',
  )

  // A mistake is explained and never sent.
  const input = panel.getByRole('textbox', { name: 'Calendar link' })
  const hint = panel.getByTestId('calendar-link-hint')
  const status = page.getByTestId('event-subscriptions-status')
  await input.fill(OUTLOOK_HTML)
  await expect(hint).toHaveText('That is the HTML link. Copy the ICS link instead.')
  await panel.getByRole('button', { name: 'Link calendar' }).click()
  await expect(status).toHaveText('That is the HTML link. Copy the ICS link instead.')
  expect(calls).toEqual([])

  // The secret address is recognised, sent once through the existing add flow, read by
  // the Function and shown by its provider's name (the calendar sends none of its own).
  await input.fill(GOOGLE_SECRET)
  await expect(hint).toHaveText('Looks like a Google Calendar secret address.')
  await panel.getByRole('button', { name: 'Link calendar' }).click()
  await expect(status).toHaveText('Linked Google Calendar: 2 upcoming events.')
  expect(calls).toHaveLength(1)
  expect(JSON.parse(calls[0]!)).toEqual({ action: 'add', url: GOOGLE_SECRET })

  const card = panel.getByRole('listitem', { name: 'Google Calendar' })
  await expect(card.getByText(/^calendar\.google\.com · Updated/)).toBeVisible()
  await expect(panel.getByText('1 of 5')).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(hint).toBeHidden()

  // Its events are stored as linked events, without the link.
  await expect
    .poll(async () => Object.values(await emulators.readEvents(account)).map(e => e.title))
    .toEqual(expect.arrayContaining(['Trail run', 'Beach volleyball']))
  const stored = JSON.stringify(await emulators.readEvents(account))
  expect(stored).not.toContain(TOKEN)

  // The link is never written back into the page or the console.
  expect(await page.content()).not.toContain(TOKEN)
  expect(logged.join('\n')).not.toContain(TOKEN)
})
