import { expect, test } from '@playwright/test'
import { captureScreen } from './capture'
import { prepareLiveDashboard } from './live-forecast'
import { SUN_PHASE_PLACES, localInstant, sunPhaseRaw } from './sun-phase-fixtures'

// Whether the sun is up comes from the place's sunrise and sunset, not from the UV
// (REVIEW6 L7): the live site said "Before sunrise ... UV returns about 9am" at 8:05am in
// Los Angeles, an hour after sunrise, because UV was still 0.4. Each place is opened at
// dawn (before sunrise), in the morning and the evening with the sun up but UV under 0.5,
// and at night (after sunset), in two zones on either side of the date line.

// Optional extra copies at 390 and 1280 px for review (FIX6C_SHOTS=<folder>).
const SHOTS = process.env.FIX6C_SHOTS

const MOMENTS = {
  'los-angeles': { dawn: '06:40', morning: '08:05', evening: '17:20', night: '21:00' },
  sydney: { dawn: '05:30', morning: '06:40', evening: '18:30', night: '22:00' },
} as const
/** When UV first reaches 0.5 on the fixture days. */
const UV_RETURNS = { 'los-angeles': '9am', sydney: '8am' } as const

for (const place of SUN_PHASE_PLACES) {
  for (const [moment, hhmm] of Object.entries(MOMENTS[place.param])) {
    test(`${place.param} at ${hhmm} (${moment})`, async ({ page }, testInfo) => {
      const at = localInstant(place, hhmm)
      if (SHOTS && testInfo.project.name.startsWith('desktop')) {
        await page.setViewportSize({ width: 1280, height: 900 })
      }
      const capture = await prepareLiveDashboard(page, testInfo, {
        at,
        tier: 'guest',
        edit: () => sunPhaseRaw(place, at),
        query: `&place=${place.param}`,
      })
      const readout = page.getByTestId('uv-readout')
      const returns = UV_RETURNS[place.param]
      if (moment === 'dawn') {
        await expect(readout).toContainText('Before sunrise')
        await expect(readout).toContainText(`UV returns about ${returns}`)
        await expect(readout).not.toContainText('tomorrow')
      } else if (moment === 'night') {
        await expect(readout).toContainText('Sun is down')
        await expect(readout).toContainText(`UV returns about ${returns} tomorrow`)
      } else {
        // The sun is up with UV under 0.5: the reading, not a sun-down state.
        await expect(readout).toContainText(/^0\.[0-4]None now/)
        await expect(readout).not.toContainText(/Before sunrise|Sun is down|UV returns/)
        await expect(page.getByTestId('hero-slot').or(page.getByTestId('hero-empty'))).toBeVisible()
      }
      // The arc marks now with the moon while the sun is down, and with the sun once it is up.
      const down = moment === 'dawn' || moment === 'night'
      await expect(page.getByTestId('sun-arc-night')).toHaveCount(down ? 1 : 0)
      if (down) await expect(page.getByTestId('sun-arc-now')).toHaveCount(0)
      else await expect(page.getByTestId('sun-arc-now')).toHaveCount(1)
      await expect(page.getByRole('heading', { name: 'Sunscreen timer' })).toHaveCount(
        moment === 'night' ? 0 : 1,
      )
      const name = `sun-phase-${place.param}-${moment}`
      await captureScreen(page, testInfo, capture, { name, fullPage: false })
      if (SHOTS) {
        const width = testInfo.project.name.startsWith('mobile') ? 390 : 1280
        const scheme = testInfo.project.name.split('-')[1]
        await page.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png` })
      }
    })
  }
}
