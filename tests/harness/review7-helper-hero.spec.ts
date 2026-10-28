import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'
import { prepareLiveDashboard } from './live-forecast'
import { SUN_PHASE_PLACES, localInstant, sunPhaseRaw } from './sun-phase-fixtures'

// The seventh review's UI findings in the link helper, the Events section and the UV card
// (REVIEW7 L5 and L7, handoff/review7.md):
// - the UV card's line under "Sun is down" kept to one line and cut the weather off at
//   320 px ("UV returns about 9am tomorrow · 66°..."); it now wraps after a dot;
// - at 5:20pm the readout said "0.1 Low now" beside a ringed 5pm chip reading 0.3: the
//   current hour's chip now shows the live reading, as "Now";
// - with Google Calendar and Outlook both offered, the "Events update while Solara is
//   open" note showed under each panel; it now shows once, below both;
// - the helper refused links that may work (Outlook's /OWA/ in capitals, Yahoo's other
//   hosts), and a refused link's sentence showed twice after "Link calendar".

// Optional copies at 320, 390 and 1280 px for review (FIX7B_SHOTS=<folder>).
const SHOTS = process.env.FIX7B_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const LA = SUN_PHASE_PLACES.find(place => place.param === 'los-angeles')!
const TOKEN = 'MadeUpToken'.repeat(3)

const widths = (t: TestInfo) => (t.project.name.startsWith('mobile') ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

/** Each width's screenshot of `testId` (with SHOTS set) and no sideways scroll. */
async function atEachWidth(
  page: Page,
  t: TestInfo,
  name: string,
  check: (width: number) => Promise<void>,
  testId?: string,
) {
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: t.project.name.startsWith('mobile') ? 844 : 900 })
    await check(width)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    if (!SHOTS) continue
    const path = `${SHOTS}/${name}-${width}-${scheme(t)}.png`
    if (testId) {
      // The sticky header would cover the element in a scrolled element screenshot.
      await page.addStyleTag({ content: '.sticky { position: static !important; }' })
      const element = page.getByTestId(testId)
      await element.scrollIntoViewIfNeeded()
      await element.screenshot({ path, animations: 'disabled', caret: 'hide' })
    } else {
      await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
    }
  }
}

async function liveDashboard(page: Page, t: TestInfo, hhmm: string) {
  const at = localInstant(LA, hhmm)
  return prepareLiveDashboard(page, t, {
    at,
    tier: 'guest',
    edit: () => sunPhaseRaw(LA, at),
    query: '&place=los-angeles',
  })
}

test('night: the line under "Sun is down" reads in full, from 320 px (L7.1)', async ({
  page,
}, t) => {
  const capture = await liveDashboard(page, t, '21:00')
  const readout = page.getByTestId('uv-readout')
  const detail = page.getByTestId('uv-readout-detail')
  await expect(readout).toContainText('Sun is down')
  await atEachWidth(
    page,
    t,
    'hero-night',
    async () => {
      await expect(detail).toHaveText('UV returns about 9am tomorrow · 66°F · Clear')
      // Nothing is cut off: each part stays whole, and a line breaks only after a dot.
      expect(
        await detail.evaluate(
          el =>
            el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis',
        ),
      ).toBe(true)
      for (const part of await detail.locator('span').all()) {
        const lines = await part.evaluate(el => el.getClientRects().length)
        expect(lines, await part.innerText()).toBe(1)
      }
    },
    'uv-readout',
  )
  if (t.project.name.startsWith('mobile')) await page.setViewportSize({ width: 320, height: 844 })
  await captureScreen(page, t, capture, { name: 'uv-readout-night-320', fullPage: false })
})

test('evening: the readout and the current hour’s chip show the same reading (L7.3)', async ({
  page,
}, t) => {
  const capture = await liveDashboard(page, t, '17:20')
  const readout = page.getByTestId('uv-readout')
  const nowChip = page
    .getByRole('group', { name: 'UV forecast by hour' })
    .locator('[data-hour="17"]')
  await atEachWidth(
    page,
    t,
    'hero-evening',
    async () => {
      const big = (await readout.locator('span').first().innerText()).trim()
      await expect(readout).toContainText(`${big}Low now`)
      // The chip that holds the "now" ring reads the live value, named "Now".
      await expect(nowChip).toHaveAccessibleName(new RegExp(`^UV ${big}\\s*, Low,\\s*Now$`))
      await expect(nowChip).toHaveText(new RegExp(`^UV ${big}\\b.*Now$`))
    },
    'uv-readout',
  )
  // Pressing it keeps the live reading in the readout (it is "now", not "5pm").
  await nowChip.click()
  const big = (await readout.locator('span').first().innerText()).trim()
  await expect(nowChip).toHaveText(new RegExp(`^UV ${big}\\b.*Now$`))
  await expect(readout).toContainText(`${big}Low now`)
  // The next hour still shows its own forecast.
  await page.getByRole('group', { name: 'UV forecast by hour' }).locator('[data-hour="16"]').click()
  await expect(readout).toContainText('at 4pm')
  await captureScreen(page, t, capture, { name: 'uv-readout-evening', fullPage: false })
})

function answer(route: Route, url: URL): Promise<void> | false {
  if (url.origin === 'https://api.open-meteo.com')
    return route.fulfill({ json: buildRawForecast() })
  if (url.origin === 'https://geocoding-api.open-meteo.com')
    return route.fulfill({ json: { results: [] } })
  return false
}

const NOTE = /Events update while Solara is open/

test('Google Calendar and Outlook share one refresh note (L7.2)', async ({ page }, t) => {
  const capture = await preparePage(page, t, answer)
  await page.goto('/harness/?screen=dashboard&outlook=on&gcal=on&google=connected')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const section = page.getByTestId('events-section')
  const outlook = page.getByTestId('outlook-calendar-events')
  await outlook.getByRole('button', { name: 'Show my Outlook events' }).click()
  await expect(page.getByTestId('outlook-calendar-status')).toBeVisible()
  const note = page.getByTestId('calendar-refresh-note')
  await expect(note).toHaveCount(1)
  await expect(note).toHaveText(
    'Events update while Solara is open: by themselves for an hour after you connect or refresh, otherwise when you press Refresh.',
  )
  // Below both panels, and not inside either.
  await expect(page.getByTestId('google-calendar-events').getByText(NOTE)).toHaveCount(0)
  await expect(outlook.getByText(NOTE)).toHaveCount(0)
  await expect(section.getByText(NOTE)).toHaveCount(1)
  const below = await note.evaluate(el => {
    const google = document.querySelector('[data-testid="google-calendar-events"]')!
    const outlookPanel = document.querySelector('[data-testid="outlook-calendar-events"]')!
    const after = (a: Element) =>
      !!(a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(el)
    return after(google) && after(outlookPanel)
  })
  expect(below).toBe(true)
  await atEachWidth(page, t, 'events-google-outlook', async () => {}, 'events-section')
  await section.scrollIntoViewIfNeeded()
  await captureScreen(page, t, capture, { name: 'events-shared-refresh-note', fullPage: false })
})

test('the link helper blocks only links that cannot be calendars, and says so once (L5)', async ({
  page,
}, t) => {
  const capture = await preparePage(page, t, answer)
  await page.goto('/harness/?screen=dashboard&links=sample&subscriptions=on')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const panel = page.getByTestId('event-subscriptions')
  const field = panel.getByRole('textbox', { name: 'Calendar link' })
  const link = panel.getByRole('button', { name: 'Link calendar' })
  const hint = panel.getByTestId('calendar-link-hint')
  const status = panel.getByTestId('event-subscriptions-status')

  // Links that may work go through with a warning: the button stays the main one.
  for (const [name, url, says] of [
    [
      'owa-caps',
      `https://outlook.office365.com/OWA/calendar/${TOKEN}@contoso.com/${TOKEN}/calendar.ics`,
      'not the usual published Outlook calendar link',
    ],
    [
      'yahoo-export',
      `https://export.calendar.yahoo.com/${TOKEN}/ycal.ics`,
      'not the usual Yahoo Calendar link',
    ],
  ] as const) {
    await field.fill(url)
    await expect(hint).toContainText(says)
    await expect(hint).not.toContainText(TOKEN)
    await expect(link).toHaveClass(/btn-primary/)
    await atEachWidth(page, t, `hint-${name}`, async () => {}, 'event-subscriptions')
  }

  // A link that cannot be a calendar is not sent, and its sentence shows once.
  await field.fill(`https://outlook.live.com/owa/calendar/0000/${TOKEN}/cid-0/calendar.html`)
  await expect(hint).toHaveText('That is the HTML link. Copy the ICS link instead.')
  await link.click()
  await expect(status).toHaveText('That is the HTML link. Copy the ICS link instead.')
  await expect(hint).toBeHidden()
  await expect(panel.getByText('That is the HTML link. Copy the ICS link instead.')).toHaveCount(1)
  // The field still describes itself with the reason.
  await expect(field).toHaveAccessibleDescription(/That is the HTML link/)
  await atEachWidth(page, t, 'hint-html-submitted', async () => {}, 'event-subscriptions')
  await captureScreen(page, t, capture, { name: 'helper-refused-once', fullPage: false })
  // Editing the link clears the refusal; the hint takes over again.
  await field.fill(`https://outlook.live.com/owa/calendar/0000/${TOKEN}/cid-0/calendar.ics`)
  await expect(status).toHaveCount(0)
  await expect(hint).toHaveText('Looks like a published Outlook calendar (ICS link).')
})
