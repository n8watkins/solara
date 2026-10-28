import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { startClock } from './clock'
import { freezeScreen } from './freeze'
import { HARNESS_MARKER } from './fixtures'

// Screenshots and axe checks for the Settings, profile and tooltip states that
// the main harness run does not open: every Settings section, the free tier,
// inline errors, the profile switcher and an open tooltip. Each state is its
// own test so its screenshot is taken before the frozen clock reaches the
// first timer that changes pixels (see freeze.ts), and each must have zero axe
// violations of any impact.
const OUTPUT_DIR = join('test-results', 'ui-harness')

type Clip = { x: number; y: number; width: number; height: number }

interface State {
  name: string
  query: string
  /** Runs before any app code, for example to seed localStorage. */
  init?: () => void
  /** Open-Meteo's place search answer; without it the search is blocked and fails. */
  places?: unknown
  desktopOnly?: string
  /** Puts the page into the state; may return a screenshot clip. */
  act: (page: Page) => Promise<Clip | void>
}

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' })

async function openTab(page: Page, name: string) {
  await settings(page).getByRole('tab', { name }).click()
  await expect(settings(page).getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

/** A clip around the open profile panel and the trigger above it. */
async function profileClip(panel: Locator): Promise<Clip> {
  const box = (await panel.boundingBox())!
  return { x: box.x - 220, y: box.y - 56, width: box.width + 240, height: box.height + 72 }
}

const STATES: State[] = [
  {
    name: 'settings-sun-help',
    query: 'screen=settings',
    act: async page => {
      await settings(page).getByRole('button', { name: 'How skin type affects Solara' }).click()
      await expect(settings(page).getByText('planning estimates, not medical advice')).toBeVisible()
    },
  },
  {
    // Pro's alerts once switched on (?alerts=on stands in for NEXT_PUBLIC_ALERTS_ENABLED
    // in the harness): the account's alert settings, with a UV alert chosen.
    name: 'settings-alerts',
    query: 'screen=settings&alerts=on',
    act: async page => {
      // The alerts have their own tab, selected while they show (REVIEW5).
      await openTab(page, 'Alerts')
      const dialog = settings(page)
      await expect(dialog.getByRole('tab', { name: 'Sun profile' })).toHaveAttribute(
        'aria-selected',
        'false',
      )
      await dialog.getByRole('combobox', { name: 'UV alert' }).selectOption('6')
      await expect(dialog.getByRole('combobox', { name: 'Quiet from' })).toHaveValue('21')
      const card = dialog
        .getByRole('heading', { name: 'Morning and UV alerts' })
        .locator('..')
        .locator('..')
      await card.scrollIntoViewIfNeeded()
      const box = (await card.boundingBox())!
      return { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 }
    },
  },
  {
    // With linked calendars switched on too (?subscriptions=on): the event heads-up.
    name: 'settings-alerts-events',
    query: 'screen=settings&alerts=on&subscriptions=on',
    act: async page => {
      await openTab(page, 'Alerts')
      const dialog = settings(page)
      const headsUp = dialog.getByRole('combobox', { name: 'Event heads-up' })
      await expect(headsUp).toHaveValue('on')
      await headsUp.selectOption('off')
      // REVIEW5 L6: heads-ups move earlier, not later, around quiet hours, and are only
      // for outdoor events.
      await expect(
        dialog.getByText('An event heads-up that would fall in them comes the evening before.'),
      ).toBeVisible()
      await expect(dialog.getByText(/About 3 hours before an outdoor event/)).toBeVisible()
      const card = dialog
        .getByRole('heading', { name: 'Morning and UV alerts' })
        .locator('..')
        .locator('..')
      await card.scrollIntoViewIfNeeded()
      const box = (await card.boundingBox())!
      return { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 }
    },
  },
  {
    name: 'settings-activities',
    query: 'screen=settings&tab=activities',
    act: async page => {
      await expect(settings(page).getByRole('tabpanel')).toContainText('Hidden suggestions')
    },
  },
  {
    name: 'settings-location',
    query: 'screen=settings&tab=location',
    act: async page => {
      await expect(settings(page).getByText('Los Angeles, California')).toBeVisible()
    },
  },
  {
    name: 'settings-location-suggestions',
    query: 'screen=settings&tab=location',
    places: {
      results: [
        {
          name: 'Pasadena',
          admin1: 'California',
          country: 'United States',
          latitude: 34.1478,
          longitude: -118.1445,
        },
        {
          name: 'Pasadena',
          admin1: 'Texas',
          country: 'United States',
          latitude: 29.6911,
          longitude: -95.2091,
        },
      ],
    },
    act: async page => {
      const field = settings(page).getByRole('combobox', { name: 'Search a city' })
      await field.fill('Pasadena')
      await expect(settings(page).getByRole('option')).toHaveCount(2)
      await field.press('ArrowDown')
      await expect(
        settings(page).getByRole('option', {
          name: 'Pasadena California, United States',
          selected: true,
        }),
      ).toBeVisible()
      await expect(settings(page).getByRole('link', { name: 'GeoNames' })).toBeVisible()
    },
  },
  {
    name: 'settings-location-no-results',
    query: 'screen=settings&tab=location',
    places: {},
    act: async page => {
      await settings(page).getByRole('combobox', { name: 'Search a city' }).fill('Nowhere')
      await page.keyboard.press('Enter')
      await expect(settings(page).getByRole('alert')).toHaveText('City not found.')
    },
  },
  {
    name: 'settings-location-error',
    query: 'screen=settings&tab=location',
    act: async page => {
      // Geocoding is off-origin and blocked, so every search fails.
      await settings(page).getByRole('combobox', { name: 'Search a city' }).fill('Nowhere')
      await page.keyboard.press('Enter')
      await expect(settings(page).getByRole('alert')).toHaveText(
        'Search is unavailable. Try again.',
      )
    },
  },
  {
    name: 'settings-account',
    query: 'screen=settings',
    act: async page => {
      await openTab(page, 'Account')
      await expect(settings(page).getByText('Alex Rivera')).toBeVisible()
    },
  },
  {
    name: 'settings-free',
    query: 'screen=settings&tier=free',
    act: async page => {
      await openTab(page, 'Alerts')
      await expect(settings(page).getByText(/Coming soon with Pro\./)).toBeVisible()
    },
  },
  {
    // Free once alerts are switched on: what Pro adds.
    name: 'settings-alerts-free',
    query: 'screen=settings&tier=free&alerts=on',
    act: async page => {
      await openTab(page, 'Alerts')
      await expect(settings(page).getByText(/Included with Pro\./)).toBeVisible()
    },
  },
  {
    // ...and with linked calendars on, the event heads-ups the Events section sells
    // (REVIEW5 L6).
    name: 'settings-alerts-free-events',
    query: 'screen=settings&tier=free&alerts=on&subscriptions=on',
    act: async page => {
      await openTab(page, 'Alerts')
      await expect(
        settings(page).getByText(/before your outdoor events\. Included with Pro\./),
      ).toBeVisible()
    },
  },
  {
    name: 'settings-account-free',
    query: 'screen=settings&tier=free',
    act: async page => {
      await openTab(page, 'Account')
      await expect(settings(page).getByRole('button', { name: 'See Pro plans' })).toBeVisible()
    },
  },
  {
    // A notification subscription this device cannot remove (the harness has
    // no Functions backend) makes sign-out stop, and the Account tab says so.
    name: 'settings-signout-error',
    query: 'screen=settings',
    init: () => {
      window.localStorage.setItem(
        'solara_notification_device_harness-user',
        JSON.stringify({ deviceId: 'device-1', token: 'token-1' }),
      )
    },
    act: async page => {
      await openTab(page, 'Account')
      await settings(page).getByRole('button', { name: 'Sign out' }).click()
      await expect(settings(page).getByRole('alert')).toHaveText(
        'Could not safely sign out. Check your connection and try again.',
      )
      await expect(settings(page)).toBeVisible()
    },
  },
  {
    name: 'profile-switcher',
    query: 'screen=dashboard',
    desktopOnly: 'the compact mobile header hides it',
    act: async page => {
      await page.getByRole('button', { name: 'Profile: Me' }).click()
      const panel = page.getByRole('dialog', { name: 'Profiles' })
      await expect(panel.getByRole('button', { name: /^Me/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      return profileClip(panel)
    },
  },
  {
    name: 'profile-editor',
    query: 'screen=dashboard',
    desktopOnly: 'the compact mobile header hides it',
    act: async page => {
      await page.getByRole('button', { name: 'Profile: Me' }).click()
      const panel = page.getByRole('dialog', { name: 'Profiles' })
      await panel.getByRole('button', { name: /Add person or pet/ }).click()
      const name = panel.getByRole('textbox', { name: 'Name' })
      await expect(name).toBeFocused()
      await name.fill('Ava')
      return profileClip(panel)
    },
  },
  {
    name: 'tooltip',
    query: 'screen=dashboard',
    act: async page => {
      const info = page.getByRole('button', { name: 'More info' }).first()
      await info.focus()
      const tip = page.getByRole('tooltip')
      await expect(tip).toBeVisible()
      const bubble = (await tip.boundingBox())!
      const trigger = (await info.boundingBox())!
      const x = Math.max(0, Math.min(bubble.x, trigger.x) - 16)
      const y = Math.max(0, bubble.y - 16)
      return {
        x,
        y,
        width: Math.max(bubble.x + bubble.width, trigger.x + trigger.width) - x + 16,
        height: trigger.y + trigger.height - y + 16,
      }
    },
  },
]

async function open(page: Page, state: State, testInfo: TestInfo) {
  const colorScheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light'
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:') return route.continue()
    if (state.places && url.origin === 'https://geocoding-api.open-meteo.com')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.places) })
    return route.abort('blockedbyclient')
  })
  await startClock(page)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  if (state.init) await page.addInitScript(state.init)
  await page.goto(`/harness/?${state.query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', /.+/)
}

/** Screenshot the current state, then require a clean axe run on it. */
async function capture(page: Page, testInfo: TestInfo, name: string, clip?: Clip) {
  await freezeScreen(page)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  const shotDir = join(OUTPUT_DIR, 'screenshots')
  mkdirSync(shotDir, { recursive: true })
  const shotPath = join(shotDir, `${name}--${testInfo.project.name}.png`)
  await page.screenshot({ path: shotPath, clip, animations: 'disabled', caret: 'hide' })
  await testInfo.attach('screenshot', { path: shotPath, contentType: 'image/png' })

  // axe-core schedules work with timers; let the (still frozen-date) clock run.
  await page.clock.resume()
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  const violations = axe.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })),
  }))
  // Same shape as ui-harness.spec.ts, so axe-summary.ts lists these states too.
  const axeDir = join(OUTPUT_DIR, 'axe')
  mkdirSync(axeDir, { recursive: true })
  const report = {
    screen: name,
    project: testInfo.project.name,
    url: page.url(),
    blockedRequests: [],
    pageErrors: [],
    violations,
  }
  writeFileSync(
    join(axeDir, `${name}--${testInfo.project.name}.json`),
    JSON.stringify(report, null, 2) + '\n',
  )
  expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([])
}

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    test.skip(
      !!state.desktopOnly && testInfo.project.name.startsWith('mobile'),
      state.desktopOnly ?? '',
    )
    const pageErrors: string[] = []
    page.on('pageerror', err => pageErrors.push(err.message))
    await open(page, state, testInfo)
    const clip = await state.act(page)
    await capture(page, testInfo, state.name, clip ?? undefined)
    expect(pageErrors, 'uncaught page errors').toEqual([])
  })
}
