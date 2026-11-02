import { expect, test, type Page } from '@playwright/test'
import { startClock } from '../harness/clock'
import { buildRawForecast } from '../harness/fixtures'

// The vitamin D log (ROADMAP item 48) on the real export, as a returning guest at 10:30 in
// Los Angeles: log a session by hand, see today's and the week's totals, edit it, reload
// and find it kept, delete it (with Undo), and "Log it" on an activity whose windows have
// passed; by keyboard, with the names a screen reader announces, in English and Spanish.

/** A guest with a morning walk (6-9am), done for today by 10:30. */
const GUEST = JSON.stringify({
  prefs: {
    location: {
      lat: 34.05,
      lon: -118.24,
      city: 'Los Angeles',
      region: 'California',
      timezone: 'America/Los_Angeles',
    },
    skinType: 'fair',
    activities: [
      {
        id: 'walk',
        name: 'Walking',
        icon: '🚶',
        durationMins: 30,
        maxUV: 3,
        sunscreen: false,
        timePreference: 'earliest',
        preferredHours: { from: 6, to: 9 },
      },
    ],
    onboardingComplete: true,
  },
  since: '2026-06-15',
})

const LANGUAGES = [
  {
    code: 'en',
    open: /Vitamin D log/,
    empty: /No sessions yet/,
    add: 'Add a session',
    length: 'Length (minutes)',
    swimwear: /Swimwear/,
    save: 'Save session',
    today: 'Today',
    week: 'Last 7 days',
    iu: /about [\d,.]+ IU/,
    sessionIu: /About [\d,.]+ IU of vitamin D/,
    sessions: 'Sessions',
    edit: /^Edit Time in the sun/,
    delete: /^Delete Time in the sun/,
    deleted: 'Session deleted.',
    undo: 'Undo',
    chart: 'Estimated vitamin D by day, last 7 days',
    logIt: 'Log it: Walking, in the vitamin D log',
    logged: /Logged Walking/,
    already: /Walking is already in today's log/,
    // Durations keep the number and "min" together with a no-break space (\s matches it).
    burn: /\d+\smin of a \d+\smin burn time/,
    close: 'Close',
  },
  {
    code: 'es',
    open: /Registro de vitamina\sD/,
    empty: /Todavía no hay sesiones/,
    add: 'Agregar una sesión',
    length: 'Duración (minutos)',
    swimwear: /Traje de baño/,
    save: 'Guardar sesión',
    today: 'Hoy',
    week: 'Últimos 7 días',
    iu: /unas [\d,.\s]+ UI/,
    sessionIu: /Unas [\d,.\s]+ UI de vitamina D/,
    sessions: 'Sesiones',
    edit: /^Editar Tiempo al sol/,
    delete: /^Eliminar Tiempo al sol/,
    deleted: 'Se eliminó la sesión.',
    undo: 'Deshacer',
    chart: 'Vitamina D estimada por día, últimos 7 días',
    logIt: 'Registrar: Walking, en el registro de vitamina D',
    logged: /Se registró Walking/,
    already: /Walking ya está en el registro de hoy/,
    burn: /de un tiempo hasta quemarte de/,
    close: 'Cerrar',
  },
] as const

async function openAsGuest(page: Page) {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({ json: buildRawForecast() }),
  )
  await page.addInitScript(guest => {
    if (!localStorage.getItem('solara_guest')) localStorage.setItem('solara_guest', guest)
    localStorage.setItem('solara.analytics-consent.v1', 'declined')
  }, GUEST)
  await startClock(page)
  await page.goto('/app/')
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    // The device's language: the guest plan follows it (Automatic), as languages.spec.ts does.
    test.use({ locale: lang.code === 'es' ? 'es-MX' : 'en-US' })

    test('log a session, see the totals, edit it, reload, delete it', async ({ page }) => {
      await openAsGuest(page)
      const opener = page.getByRole('button', { name: lang.open })
      await expect(opener).toBeVisible()

      // By keyboard: the dashboard's button opens the log, named for a screen reader.
      await opener.focus()
      await page.keyboard.press('Enter')
      const log = page.getByRole('dialog', { name: lang.open })
      await expect(log).toBeVisible()
      await expect(log).toContainText(lang.empty)
      await expect(log.getByTestId('vitd-total-today')).toContainText(lang.today)

      // Add a session: 20 minutes in swimwear, now, with the forecast's UV.
      await log.getByRole('button', { name: lang.add }).click()
      const form = page.getByRole('dialog', { name: lang.add })
      await expect(form).toBeVisible()
      await form.getByLabel(lang.length).fill('20')
      // The skin presets are one radio group: arrow keys move between them.
      await form.getByRole('radio', { name: /Arms and legs|Brazos y piernas/ }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(form.getByRole('radio', { name: lang.swimwear })).toBeChecked()
      await expect(form.getByTestId('vitd-form-estimate')).toContainText(lang.sessionIu)
      await form.getByRole('button', { name: lang.save }).click()

      // Back on the list, focus on its heading; the session with its estimate and burn risk.
      await expect(log.getByRole('heading', { name: lang.sessions })).toBeFocused()
      const session = log.getByTestId('vitd-session')
      await expect(session).toHaveCount(1)
      await expect(session).toContainText(lang.sessionIu)
      await expect(session.getByTestId('vitd-session-burn')).toContainText(lang.burn)
      const todayTotal = await log.getByTestId('vitd-total-today').innerText()
      expect(todayTotal).toMatch(lang.iu)
      await expect(log.getByTestId('vitd-total-week')).toContainText(lang.iu)
      // The chart is a table for a screen reader, today's row included.
      const table = log.getByRole('table', { name: lang.chart })
      await expect(table.getByRole('row')).toHaveCount(8)

      // Edit: twice as long makes a larger estimate.
      const before = await session.getByTestId('vitd-session-iu').innerText()
      await log.getByRole('button', { name: lang.edit }).click()
      const editing = page.getByRole('dialog')
      await expect(editing.getByLabel(lang.length)).toHaveValue('20')
      await editing.getByLabel(lang.length).fill('40')
      await editing.getByRole('button', { name: lang.save }).click()
      await expect(session.getByTestId('vitd-session-iu')).not.toHaveText(before)
      const after = await session.getByTestId('vitd-session-iu').innerText()

      // Escape closes the log, and focus goes back to its button.
      await page.keyboard.press('Escape')
      await expect(log).toHaveCount(0)
      await expect(opener).toBeFocused()

      // A reload keeps the session, edited.
      await page.reload()
      await page.getByRole('button', { name: lang.open }).click()
      await expect(log.getByTestId('vitd-session')).toHaveCount(1)
      await expect(log.getByTestId('vitd-session-iu')).toHaveText(after)

      // Delete, Undo brings it back, delete again.
      await log.getByRole('button', { name: lang.delete }).click()
      await expect(log.getByRole('status')).toContainText(lang.deleted)
      await expect(log.getByTestId('vitd-session')).toHaveCount(0)
      await log.getByRole('button', { name: lang.undo }).click()
      await expect(log.getByTestId('vitd-session')).toHaveCount(1)
      await log.getByRole('button', { name: lang.delete }).click()
      await expect(log.getByTestId('vitd-session')).toHaveCount(0)
      await expect(log).toContainText(lang.empty)

      // Nothing is left after a reload either.
      await page.reload()
      await page.getByRole('button', { name: lang.open }).click()
      await expect(log).toContainText(lang.empty)
    })

    test('"Log it" logs a finished activity once, at its planned time', async ({ page }) => {
      await openAsGuest(page)
      const logIt = page.getByRole('button', { name: lang.logIt })
      await expect(logIt).toBeVisible()
      await logIt.click()
      const log = page.getByRole('dialog', { name: lang.open })
      await expect(log.getByRole('status')).toContainText(lang.logged)
      const session = log.getByTestId('vitd-session')
      await expect(session).toHaveCount(1)
      await expect(session).toContainText('Walking')
      // The walk's slot starts at 6am, the start of its preferred hours, for 30 minutes.
      await expect(session).toContainText(/6(:00)?\s?(am|a\.\s?m\.)/)
      await page.getByRole('button', { name: lang.close }).click()

      // A second tap opens the session already there instead of logging it twice.
      await logIt.click()
      await expect(log.getByRole('status')).toContainText(lang.already)
      await expect(log.getByTestId('vitd-session')).toHaveCount(1)
    })
  })
}
