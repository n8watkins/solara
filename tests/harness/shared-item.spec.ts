import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test'
import { INVITE } from '../e2e/share-sheet'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER, buildRawForecast } from './fixtures'

// "Shared with Solara" (components/events/SharedItem.tsx): what someone shared to the
// installed app, at the top of the dashboard, in each of its states. The service worker
// keeps a share in Cache Storage (lib/share-target.ts); the harness has no worker, so each
// test puts the share there itself, then opens the dashboard with `?shared=<id>`. Each
// state is captured at the project's width (1440 or 390 px) and at 1280 or 320 px, light
// and dark, with an axe report. The page the share address shows before the worker runs
// is captured too.

const ID = 'a1b2c3d4e5f60718'

function answerOpenMeteo(route: Route, url: URL): Promise<void> | false {
  if (url.origin === 'https://api.open-meteo.com') {
    return route.fulfill({ json: buildRawForecast() })
  }
  if (url.origin === 'https://geocoding-api.open-meteo.com') {
    return route.fulfill({ json: { results: [] } })
  }
  return false
}

type Share =
  | { kind: 'file'; name: string; body: string }
  | { kind: 'link'; link: string }
  | { kind: 'refused'; reason: 'too-large' | 'not-calendar' | 'nothing' }

/** Keeps a share as the worker would (lib/share-target.ts putStash), dated now. */
async function keepShare(page: Page, share: Share) {
  await page.evaluate(
    async ({ id, share }) => {
      const { body = '', ...rest } = share as Share & { body?: string }
      const meta = { v: 1, id, at: Date.now(), ...rest }
      const cache = await caches.open('solara-share-v1')
      await cache.put(
        '/app/share-target/item',
        new Response(body, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Solara-Share': encodeURIComponent(JSON.stringify(meta)),
          },
        }),
      )
    },
    { id: ID, share },
  )
}

/** Opens the dashboard with a share kept, as the worker's redirect does. */
async function openShared(page: Page, query: string, share: Share | null) {
  await page.goto(`/harness/?${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  if (share) await keepShare(page, share)
  await page.goto(`/harness/?${query}&shared=${ID}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const card = page.getByRole('region', { name: 'Shared with Solara' })
  await expect(card).toBeVisible()
  return card
}

async function cardShot(page: Page, testInfo: TestInfo, name: string, testId = 'shared-item') {
  const dir = join('test-results', 'ui-harness', 'screenshots')
  mkdirSync(dir, { recursive: true })
  await page.addStyleTag({ content: '.sticky { position: static !important; }' })
  await page.getByTestId(testId).screenshot({
    path: join(dir, `${name}--${testInfo.project.name}.png`),
    animations: 'disabled',
    caret: 'hide',
  })
}

/** The full screen with axe, then the card at this width and at the narrow one. */
async function captureState(
  page: Page,
  testInfo: TestInfo,
  capture: Awaited<ReturnType<typeof preparePage>>,
  name: string,
  testId = 'shared-item',
) {
  await captureScreen(page, testInfo, capture, { name, fullPage: false })
  await cardShot(page, testInfo, name, testId)
  const narrow = testInfo.project.name.startsWith('mobile') ? 320 : 1280
  await page.setViewportSize({ width: narrow, height: 900 })
  await cardShot(page, testInfo, `${name}-${narrow}`, testId)
}

const FILE: Share = { kind: 'file', name: 'invite.ics', body: INVITE }

test('a guest sees the shared file and is asked to sign in', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=guest', FILE)
  await expect(card).toContainText('invite.ics has 2 upcoming events.')
  await expect(card.getByRole('listitem')).toHaveText([
    'Tuesday 10K Tomorrow · 9am–10:30am',
    'Picnic Wed, Jun 17 · 12pm–1:30pm',
  ])
  await expect(card.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible()
  await captureState(page, testInfo, capture, 'shared-file-guest')
})

test('a signed-in account confirms the import, then sees what was imported', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=free', FILE)
  const importButton = card.getByRole('button', { name: 'Import 2 events' })
  await expect(importButton).toBeVisible()
  await captureState(page, testInfo, capture, 'shared-file-preview')

  await importButton.click()
  await expect(card.getByRole('status')).toHaveText(/^Imported 2 events\./)
  await expect(card.getByRole('button', { name: 'Done' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Events' }).getByTestId('event-card')).toHaveCount(
    2,
  )
  await cardShot(page, testInfo, 'shared-file-imported')
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(card).toHaveCount(0)
})

test('a refused file says why', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=free', {
    kind: 'refused',
    reason: 'too-large',
  })
  await expect(card.getByRole('alert')).toHaveText(
    'That file is larger than 1 MB. Export a shorter range of events, then share it again.',
  )
  await captureState(page, testInfo, capture, 'shared-refused')
})

test('nothing to import once a share was used or expired', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=free', null)
  await expect(card).toContainText('Nothing to import')
  await captureState(page, testInfo, capture, 'shared-nothing')
})

test('a web page link explains how to get a calendar file', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=free&subscriptions=on', {
    kind: 'link',
    link: 'https://www.meetup.com/la-hikers/events/123456/',
  })
  await expect(card).toContainText('That is a link to a web page (www.meetup.com)')
  await captureState(page, testInfo, capture, 'shared-web-page')
})

test('a calendar link on Free offers Pro', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  const card = await openShared(page, 'screen=dashboard&tier=free&subscriptions=on', {
    kind: 'link',
    link: 'webcal://club.example/races.ics',
  })
  await expect(card).toContainText("Linked calendars, which keep a calendar's events current")
  await expect(card.getByRole('button', { name: 'See Pro' })).toBeVisible()
  await captureState(page, testInfo, capture, 'shared-link-free')
})

test('a calendar link on Pro opens the linked calendars form, prefilled', async ({
  page,
}, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  // A made-up token, spelled out as a pattern so secret scanners do not mistake it.
  const link = `https://calendar.google.com/calendar/ical/club%40group.calendar.google.com/private-${'MadeUpToken'.repeat(3)}/basic.ics`
  const card = await openShared(page, 'screen=dashboard&links=sample&subscriptions=on', {
    kind: 'link',
    link,
  })
  await expect(card).toContainText('A calendar link from calendar.google.com.')
  await captureState(page, testInfo, capture, 'shared-link-pro')
  await page.setViewportSize(testInfo.project.use.viewport!)

  await card.getByRole('button', { name: 'Add this calendar' }).click()
  const panel = page.getByTestId('event-subscriptions')
  await expect(panel.getByRole('textbox', { name: 'Calendar link' })).toHaveValue(link)
  await expect(panel.getByTestId('add-calendar-steps')).toHaveAttribute('data-provider', 'google')
  await expect(panel.getByTestId('calendar-link-hint')).toHaveText(
    'Looks like a Google Calendar secret address.',
  )
  await expect(card).toContainText('is in Linked calendars below')
  await captureState(page, testInfo, capture, 'shared-link-pro-form', 'event-subscriptions')
})

test('the share address before the worker runs asks to share again', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo, answerOpenMeteo)
  await page.goto('/app/share-target/')
  await expect(page.getByRole('heading', { name: 'Share it again' })).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'share-target-fallback', fullPage: false })
  const narrow = testInfo.project.name.startsWith('mobile') ? 320 : 1280
  await page.setViewportSize({ width: narrow, height: 900 })
  await captureScreen(page, testInfo, capture, {
    name: `share-target-fallback-${narrow}`,
    fullPage: false,
  })
})
