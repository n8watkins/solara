import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// "Add a calendar from..." (docs/integrations/CALENDAR_LINKS.md, ROADMAP item 24): the
// helper under Linked calendars, switched on with ?subscriptions=on as the deploy's
// NEXT_PUBLIC_EVENTS_SUBSCRIPTIONS_ENABLED would. Each provider's steps are captured at
// the project's width (1440 or 390 px) and at 1280 or 320 px, with an axe report.

function answerOpenMeteo(route: Route, url: URL): Promise<void> | false {
  if (url.origin === 'https://api.open-meteo.com') {
    return route.fulfill({ json: buildRawForecast() })
  }
  return false
}

const PAGE = '/harness/?screen=dashboard&links=sample&subscriptions=on'

/** Made-up tokens in real-shaped links (packages/core/src/calendar-providers.test.ts). */
// Spelled out as a pattern, so secret scanners do not mistake it for a real token.
const TOKEN = 'MadeUpToken'.repeat(3)
const GOOGLE_SECRET = `https://calendar.google.com/calendar/ical/ola.reyes%40gmail.com/private-${TOKEN}/basic.ics`
const GOOGLE_PUBLIC =
  'https://calendar.google.com/calendar/ical/club%40group.calendar.google.com/public/basic.ics'
const OUTLOOK_HTML = `https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/${TOKEN}/cid-0123456789ABCDEF/calendar.html`

async function panelShot(page: Page, testInfo: TestInfo, name: string) {
  const dir = join('test-results', 'ui-harness', 'screenshots')
  mkdirSync(dir, { recursive: true })
  // The sticky header would cover the top of the panel scrolled into view.
  await page.addStyleTag({ content: '.sticky { position: static !important; }' })
  await page.getByTestId('event-subscriptions').screenshot({
    path: join(dir, `${name}--${testInfo.project.name}.png`),
    animations: 'disabled',
    caret: 'hide',
  })
}

async function openGuide(page: Page) {
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const panel = page.getByTestId('event-subscriptions')
  const toggle = panel.getByRole('button', { name: 'Add a calendar from…' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const guide = panel.getByTestId('add-calendar-guide')
  await expect(guide).toBeVisible()
  return { panel, toggle, guide }
}

test('the helper is hidden while linked calendars are switched off', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('-light'), 'once per width')
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/harness/?screen=dashboard&links=sample')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add a calendar from…' })).toHaveCount(0)
  await expect(page.getByTestId('add-calendar-guide')).toHaveCount(0)
})

const PROVIDERS = [
  {
    name: 'Apple iCloud',
    slug: 'icloud',
    headings: ['On a computer', 'On iPhone or iPad'],
    first: 'Go to icloud.com/calendar and sign in.',
    note: 'To stop sharing, turn Public Calendar off.',
  },
  {
    name: 'Google',
    slug: 'google',
    headings: [],
    first: 'On a computer, open Google Calendar.',
    note: 'If the link leaks, click Reset in the same place.',
  },
  {
    name: 'Outlook.com',
    slug: 'outlook',
    headings: [],
    first: 'On a computer, open Outlook.com and go to Calendar.',
    note: 'To change the link, use Reset links or Unpublish there.',
  },
  {
    name: 'Yahoo',
    slug: 'yahoo',
    headings: [],
    first: null,
    note: 'To stop sharing, turn the shareable link off.',
  },
] as const

for (const provider of PROVIDERS) {
  test(`steps for ${provider.name}`, async ({ page }, testInfo) => {
    const capture = await preparePage(page, testInfo, answerOpenMeteo)
    await page.goto(PAGE)
    const { guide } = await openGuide(page)
    const choices = guide.getByRole('radiogroup', { name: 'Where is the calendar?' })
    await expect(choices.getByRole('radio')).toHaveCount(4)
    await expect(guide.getByTestId('add-calendar-steps')).toHaveCount(0)

    await choices.getByRole('radio', { name: provider.name }).check()
    const steps = guide.getByTestId('add-calendar-steps')
    await expect(steps).toHaveAttribute('data-provider', provider.slug)
    if (provider.first) {
      const firstList = steps.locator('ol').first()
      await expect(firstList.getByRole('listitem').first()).toContainText(provider.first)
      await expect(firstList.getByRole('listitem').last()).toContainText('Paste the link below.')
    } else {
      // Yahoo's steps are unconfirmed (CALENDAR_LINKS.md, open questions): one sentence.
      await expect(steps.locator('ol')).toHaveCount(0)
      await expect(steps).toContainText('copy its ICS link and paste it below.')
    }
    for (const heading of provider.headings) {
      await expect(steps.getByRole('list', { name: heading })).toBeVisible()
    }
    await expect(steps).toContainText(provider.note)
    // Every provider ends with the same notes: the link is a key, and it is not live.
    await expect(steps).toContainText('This link works like a password')
    await expect(steps).toContainText(
      'Solara checks the link about every 6 hours, so changes can take a few hours to show.',
    )

    const panel = page.getByTestId('event-subscriptions')
    await panel.scrollIntoViewIfNeeded()
    await captureScreen(page, testInfo, capture, {
      name: `add-calendar-${provider.slug}`,
      fullPage: false,
    })
    await panelShot(page, testInfo, `add-calendar-${provider.slug}`)
    const narrow = testInfo.project.name.startsWith('mobile') ? 320 : 1280
    await page.setViewportSize({ width: narrow, height: 900 })
    await panelShot(page, testInfo, `add-calendar-${provider.slug}-${narrow}`)
  })
}

test('the Google choice offers events from Google Calendar when they are on', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('-light'), 'copy check, once per width')
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto(`${PAGE}&gcal=on`)
  const { guide } = await openGuide(page)
  await guide.getByRole('radio', { name: 'Google' }).check()
  await expect(guide).toContainText('Or show events from Google Calendar above, with no link.')
  await page.goto(PAGE)
  const reopened = await openGuide(page)
  await reopened.guide.getByRole('radio', { name: 'Google' }).check()
  await expect(reopened.guide).not.toContainText('Or show events from Google Calendar')
})

test('keyboard: open the helper, pick a provider with the arrow keys, close it', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop-light'), 'behaviour, once')
  await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto(PAGE)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const panel = page.getByTestId('event-subscriptions')
  const toggle = panel.getByRole('button', { name: 'Add a calendar from…' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const controls = await toggle.getAttribute('aria-controls')
  await expect(page.locator(`[id="${controls}"]`)).toBeVisible()

  // Tab enters the group on its first radio; arrows move and choose.
  await page.keyboard.press('Tab')
  const icloud = panel.getByRole('radio', { name: 'Apple iCloud' })
  await expect(icloud).toBeFocused()
  await page.keyboard.press('Space')
  await expect(icloud).toBeChecked()
  await page.keyboard.press('ArrowRight')
  const google = panel.getByRole('radio', { name: 'Google' })
  await expect(google).toBeFocused()
  await expect(google).toBeChecked()
  await expect(panel.getByTestId('add-calendar-steps')).toHaveAttribute('data-provider', 'google')
  // The next Tab leaves the group for the link field below the steps.
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('textbox', { name: 'Calendar link' })).toBeFocused()

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(`[id="${controls}"]`)).toBeHidden()
})

test('a pasted link is recognised, and a mistake is caught before it is sent', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto(PAGE)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const panel = page.getByTestId('event-subscriptions')
  const input = panel.getByRole('textbox', { name: 'Calendar link' })
  const hint = panel.getByTestId('calendar-link-hint')
  const status = page.getByTestId('event-subscriptions-status')
  await expect(panel.getByTestId('event-subscription')).toHaveCount(3)
  await expect(hint).toBeHidden()

  // Recognised: the field names the provider (and is described by the hint).
  await input.fill(GOOGLE_SECRET)
  await expect(hint).toHaveText('Looks like a Google Calendar secret address.')
  await expect(input).toHaveAccessibleDescription(/Looks like a Google Calendar secret address\./)
  await panel.scrollIntoViewIfNeeded()
  await captureScreen(page, testInfo, capture, { name: 'add-calendar-recognised', fullPage: false })
  await panelShot(page, testInfo, 'add-calendar-recognised')

  // A provider's HTML page is explained, and Link calendar sends nothing.
  await input.fill(OUTLOOK_HTML)
  await expect(hint).toHaveText('That is the HTML link. Copy the ICS link instead.')
  await panelShot(page, testInfo, 'add-calendar-mistake')
  await panel.getByRole('button', { name: 'Link calendar' }).click()
  await expect(status).toHaveText('That is the HTML link. Copy the ICS link instead.')
  await expect(status).toHaveAttribute('role', 'alert')
  await expect(panel.getByTestId('event-subscription')).toHaveCount(3)
  await expect(panel.getByText('3 of 5')).toBeVisible()

  // Google's public address works for a public calendar: warned, but linked.
  await input.fill(GOOGLE_PUBLIC)
  await expect(hint).toContainText("That is Google's public address, which works only")
  await panel.getByRole('button', { name: 'Link calendar' }).click()
  await expect(status).toHaveText('Linked Club rides: 3 upcoming events.')
  await expect(panel.getByTestId('event-subscription')).toHaveCount(4)
  await expect(hint).toBeHidden()

  // The link itself is never written back into the page.
  const html = await page.content()
  expect(html).not.toContain(TOKEN)
  expect(html).not.toContain('club%40group')
})
