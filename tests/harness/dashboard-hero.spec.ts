import { expect, test, type Page } from '@playwright/test'
import { captureScreen } from './capture'
import { prepareLiveDashboard } from './live-forecast'
import { SUN_PHASE_PLACES, localInstant, sunPhaseRaw } from './sun-phase-fixtures'

// The dashboard's hero and briefing through a day in Los Angeles in late October
// (sunrise 7:09am, sunset 6:04pm; sun-phase-fixtures.ts), for a guest whose one
// activity is a 45-minute run up to UV 4:
// - dawn (6:40am): UV is 0 but the sun is down, so no slot starts before sunrise
//   (7:10am, the first 5-minute step after it), in the hero or the briefing.
// - morning (8:05am): the hero's time stays on one line and its subtitle reads in full
//   with the "Start now" badge, from 320 px; the reading says "Low", the WHO band for
//   an index of 0-2, never "None".
// - evening (5:20pm): 40 minutes of daylight are left, too few for the run; the hero and
//   the briefing both still speak of today, and neither offers a slot after sunset.
// - night (9pm): after sunset today is over for both: the briefing turns to tomorrow and
//   the hero steps aside.

// Optional copies at 320, 390 and 1280 px for review (HERO_SHOTS=<folder>).
const SHOTS = process.env.HERO_SHOTS

const LA = SUN_PHASE_PLACES.find(place => place.param === 'los-angeles')!
const MOMENTS = { dawn: '06:40', morning: '08:05', evening: '17:20', night: '21:00' } as const

/** The element's text fits its box: nothing cut off with an ellipsis. */
async function fitsWidth(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .evaluate(
      el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis',
    )
}

/** The element renders as a single line of text. */
async function lineCount(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate(el => {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
    return Math.round(el.getBoundingClientRect().height / lineHeight)
  })
}

for (const [moment, hhmm] of Object.entries(MOMENTS)) {
  test(`hero and briefing at ${hhmm} (${moment})`, async ({ page }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('mobile')
    const scheme = testInfo.project.name.split('-')[1]
    const at = localInstant(LA, hhmm)
    const capture = await prepareLiveDashboard(page, testInfo, {
      at,
      tier: 'guest',
      edit: () => sunPhaseRaw(LA, at),
      query: '&place=los-angeles',
    })
    const briefing = page.getByTestId('daily-briefing')
    await expect(briefing).toBeVisible()

    const widths = mobile ? [320, 390] : [1280]
    if (SHOTS) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: mobile ? 844 : 900 })
        await page.screenshot({ path: `${SHOTS}/hero-${moment}-${width}-${scheme}.png` })
      }
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: mobile ? 844 : 900 })

      const hero = page.getByTestId('hero-slot')
      const empty = page.getByTestId('hero-empty')
      if (moment === 'dawn' || moment === 'morning') {
        await expect(briefing).toContainText('Today at a glance')
        await expect(hero).toBeVisible()
        const start = Number(await hero.getAttribute('data-start'))
        // Never before sunrise (7:09am): the first slot starts at 7:10 at the earliest.
        expect(start).toBeGreaterThanOrEqual(LA.sunrise)
        await expect(briefing).not.toContainText(/6:\d\dam/)
        expect(await lineCount(page, 'hero-time')).toBe(1)
        expect(await fitsWidth(page, 'hero-time')).toBe(true)
        expect(await fitsWidth(page, 'hero-detail')).toBe(true)
        await expect(page.getByTestId('hero-detail')).toContainText(/Peak UV \d\.\d$/)
        if (moment === 'dawn') {
          await expect(hero).toContainText('7:10am')
          await expect(hero).not.toContainText('Start now')
          await expect(briefing).toContainText('Running 7:10am–11am')
        } else {
          await expect(hero).toContainText('Start now')
          await expect(page.getByTestId('uv-readout')).toContainText(/^0\.\dLow\b/)
        }
      } else if (moment === 'evening') {
        // Sunset is at 6:04pm: the run (45 minutes) no longer fits today, and both cards
        // still speak of today.
        await expect(briefing).toContainText('Today at a glance')
        await expect(briefing).toContainText('No lower-UV window left for Running')
        await expect(hero).toHaveCount(0)
        await expect(empty).toContainText('No lower-UV slot left today')
        await expect(page.getByTestId('uv-readout')).toContainText(/^0\.\dLow\b/)
      } else {
        await expect(briefing).toContainText('Tomorrow at a glance')
        await expect(hero).toHaveCount(0)
        await expect(empty).toHaveCount(0)
      }
      await expect(page.getByText(/\bNone now\b/)).toHaveCount(0)
    }

    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    else await page.setViewportSize({ width: 1440, height: 900 })
    await captureScreen(page, testInfo, capture, {
      name: `dashboard-hero-${moment}`,
      fullPage: false,
    })
  })
}
