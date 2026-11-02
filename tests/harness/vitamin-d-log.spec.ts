import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage, type Capture } from './capture'
import { HARNESS_DATE } from './clock'
import { buildRawForecast, buildUser, HARNESS_MARKER } from './fixtures'
import { vitaminDLogKey } from '@/lib/vitamin-d-owner'

// The vitamin D log (ROADMAP item 48) in English and Spanish, light and dark, for the
// harness's signed-in account (its own log key): the log with a week of sessions (one past
// the burn time), the new-session form for today (UV from the forecast) and an earlier
// day's edit (UV typed in), each with an axe report, at the project's width and at 320 and
// 390 px or 1280 px, without sideways scrolling. VITD_SHOTS=<folder> saves each width.

const SHOTS = process.env.VITD_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

/** A day `days` before the harness's today. */
function daysBefore(days: number): string {
  const date = new Date(`${HARNESS_DATE}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const span = (minutes: number, uv: number) => [{ minutes, uv }]

/** A week of sessions for fair skin. */
const LOG = {
  version: 1,
  entries: [
    {
      id: 'today-run',
      date: HARNESS_DATE,
      start: '08:00',
      minutes: 45,
      exposure: 'arms-legs',
      sunscreen: false,
      skinType: 'fair',
      uvSource: 'forecast',
      uv: span(45, 2.4),
      activityId: 'run',
      label: 'Running',
    },
    {
      id: 'yesterday-beach',
      date: daysBefore(1),
      start: '12:30',
      minutes: 90,
      exposure: 'swimwear',
      sunscreen: false,
      skinType: 'fair',
      uvSource: 'entered',
      uv: span(90, 8),
    },
    {
      id: 'garden',
      date: daysBefore(3),
      start: '16:00',
      minutes: 30,
      exposure: 'face-arms',
      sunscreen: true,
      skinType: 'fair',
      uvSource: 'entered',
      uv: span(30, 4.5),
    },
    {
      id: 'walk',
      date: daysBefore(5),
      start: '10:15',
      minutes: 20,
      exposure: 'face-hands',
      sunscreen: false,
      skinType: 'fair',
      uvSource: 'entered',
      uv: span(20, 6),
    },
  ],
}

const LANGUAGES = [
  {
    code: 'en',
    open: /Vitamin D log/,
    add: 'Add a session',
    editYesterday: /^Edit Time in the sun/,
    past: 'Past your burn time',
  },
  {
    code: 'es',
    open: /Registro de vitamina\sD/,
    add: 'Agregar una sesión',
    editYesterday: /^Editar Tiempo al sol/,
    past: 'Pasaste tu tiempo hasta quemarte',
  },
] as const

async function openLog(page: Page, t: TestInfo, code: 'en' | 'es'): Promise<Capture> {
  const capture = await preparePage(page, t, (route, url) =>
    url.hostname === 'api.open-meteo.com' ? route.fulfill({ json: buildRawForecast() }) : false,
  )
  await page.addInitScript(
    ({ language, log, key }) => {
      try {
        window.localStorage.setItem('solara_language', language)
        window.localStorage.setItem(key, log)
      } catch {}
    },
    { language: code, log: JSON.stringify(LOG), key: vitaminDLogKey(buildUser().uid) },
  )
  await page.goto('/harness/?screen=dashboard')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  return capture
}

/** No sideways scrolling at each width, and a copy of the screen when VITD_SHOTS is set. */
async function atEachWidth(page: Page, t: TestInfo, name: string) {
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]')
      const page = document.documentElement.scrollWidth - document.documentElement.clientWidth
      const inDialog = dialog
        ? // Drawn content only: a screen reader's table (.sr-only) sits outside on purpose.
          [...dialog.querySelectorAll('*')]
            .filter(el => !el.closest('.sr-only'))
            .some(
              el => el.getBoundingClientRect().right > dialog.getBoundingClientRect().right + 0.5,
            )
        : false
      return { page, inDialog }
    })
    expect(overflow.page, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    expect(overflow.inDialog, `${name} at ${width} px spills out of the dialog`).toBe(false)
  }
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test('the log lists sessions with their estimate and burn risk', async ({ page }, testInfo) => {
      const capture = await openLog(page, testInfo, lang.code)
      await page.getByRole('button', { name: lang.open }).click()
      const dialog = page.getByRole('dialog', { name: lang.open })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByTestId('vitd-session')).toHaveCount(4)
      // Yesterday's 90 minutes in swimwear at UV 8 went far past fair skin's burn time.
      await expect(dialog.getByTestId('vitd-session').nth(1)).toContainText(lang.past)
      // Screen readers get the chart as a table.
      await expect(dialog.getByRole('table')).toHaveCount(1)
      await expect(dialog.getByRole('table').getByRole('row')).toHaveCount(8)
      await atEachWidth(page, testInfo, `vitd-log-${lang.code}`)
      await captureScreen(page, testInfo, capture, {
        name: `vitamin-d-log-${lang.code}`,
        fullPage: false,
      })
    })

    test('the form: a new session today, and an earlier day with its own UV', async ({
      page,
    }, testInfo) => {
      const capture = await openLog(page, testInfo, lang.code)
      await page.getByRole('button', { name: lang.open }).click()
      await page.getByRole('button', { name: lang.add }).click()
      const form = page.getByRole('dialog', { name: lang.add })
      await expect(form.getByTestId('vitd-form-uv')).toBeVisible()
      await expect(form.getByTestId('vitd-form-estimate')).toContainText(/IU|UI/)
      await atEachWidth(page, testInfo, `vitd-new-${lang.code}`)

      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: lang.editYesterday }).first().click()
      await expect(page.getByRole('spinbutton').last()).toHaveValue('8')
      await atEachWidth(page, testInfo, `vitd-edit-${lang.code}`)
      await captureScreen(page, testInfo, capture, {
        name: `vitamin-d-log-edit-${lang.code}`,
        fullPage: false,
      })
    })
  })
}
