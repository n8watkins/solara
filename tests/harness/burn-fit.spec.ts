import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Burn-time fit and fuller sun-safety advice (ROADMAP item 56): each activity card's fit
// line (in its recommended slot), the hero's, the briefing's fit and advice lines, and the
// sunscreen guidance's gear line, in English and Spanish at 320 and 390 px (mobile
// projects) and 1280 px (desktop), light and dark: nothing cut off, no line wrapping
// inside a time range or a value, no sideways scroll, and a clean axe run.
// FIT_SHOTS=<folder> saves a copy of each part at each width.

const SHOTS = process.env.FIT_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

// The harness plan for fair skin at 10:30am on a day that peaks at Extreme: Running (45 min
// under UV 4) waits for 6pm, where it just fits the burn time but the UV still calls for
// sunscreen; Hiking (2 h with SPF, so under UV 8) is too long even with sunscreen at 4pm
// and fits from 6pm; Tennis (1 h after 4pm, the latest slot) fits unprotected at 7pm. With
// "Plan for a group" (Me and Maya, very fair), Running needs sunscreen to fit.
const LANGUAGES = {
  en: {
    fitsProtect:
      /^Fits without sunscreen \(you'd burn in about 45 min\), but use SPF 50\+ at this UV\.$/,
    tooLong:
      /^Too long even with SPF 50\+ \(you'd burn in about 49 min\): split it, or move it to 6pm–8pm\.$/,
    fits: /^Fits without sunscreen: you'd burn in about 2 h 16 min\.$/,
    sunscreen: /^Longer than your burn time \(about 30 min\): fits with SPF 50\+\.$/,
    advice: /wear a hat, sunglasses and sunscreen/,
    gear: 'Add a shirt, a hat and sunglasses, and stay in the shade around midday.',
    howMuch: 'How much sunscreen?',
    timer: 'Sunscreen timer',
  },
  es: {
    fitsProtect:
      /^Puedes hacerlo sin protector solar \(te quemarías en unos 45 min\), pero usa FPS 50\+ con este UV\.$/,
    tooLong:
      /^Dura demasiado aun con FPS 50\+ \(te quemarías en unos 49 min\): divídelo o muévelo a .+–.+\.$/,
    fits: /^Puedes hacerlo sin protector solar: te quemarías en unos 2 h 16 min\.$/,
    sunscreen: /^Dura más que tu tiempo hasta quemarte \(unos 30 min\): hazlo con FPS 50\+\.$/,
    advice: /usa sombrero, lentes de sol y protector solar/,
    gear: 'Suma una camiseta, un sombrero y lentes de sol, y quédate a la sombra cerca del mediodía.',
    howMuch: '¿Cuánto protector solar?',
    timer: 'Temporizador de protector solar',
  },
} as const

/** At each width: a copy of `part`, nothing cut off in it, and no sideways scroll. */
async function atEachWidth(page: Page, t: TestInfo, name: string, part: Locator) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    await part.scrollIntoViewIfNeeded()
    if (SHOTS) {
      await part.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    const clipped = await part.evaluate(root =>
      [...root.querySelectorAll<HTMLElement>('p, li, span')]
        .filter(
          el =>
            !el.classList.contains('sr-only') &&
            el.scrollWidth > el.clientWidth + 1 &&
            getComputedStyle(el).overflow !== 'visible',
        )
        .map(el => el.textContent),
    )
    expect(clipped, `${name} at ${width} px cuts text off`).toEqual([])
    // A time range or a value kept whole never runs past the fit line's right edge.
    const spill = await part.evaluate(root =>
      [...root.querySelectorAll<HTMLElement>('[data-testid="burn-fit"]')].flatMap(line => {
        const right = line.getBoundingClientRect().right
        return [...line.querySelectorAll('span')]
          .filter(span => span.getBoundingClientRect().right > right + 0.5)
          .map(span => span.textContent)
      }),
    )
    expect(spill, `${name} at ${width} px spills past the fit line`).toEqual([])
  }
}

for (const lang of ['en', 'es'] as const) {
  const words = LANGUAGES[lang]
  test.describe(`in ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(language => {
        try {
          window.localStorage.setItem('solara_language', language)
        } catch {}
      }, lang)
    })

    test('each activity card and the hero say whether the plan fits the burn time', async ({
      page,
    }, t) => {
      const capture = await preparePage(page, t)
      await page.goto('/harness/?screen=dashboard')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      const card = (id: string) =>
        page.locator(`[data-testid="activity-card"][data-activity="${id}"]`)
      const fit = (id: string) => card(id).getByTestId('recommended-slot').getByTestId('burn-fit')

      await expect(fit('run')).toHaveAttribute('data-verdict', 'fits')
      await expect(fit('run')).toHaveText(words.fitsProtect)
      await expect(fit('hike')).toHaveAttribute('data-verdict', 'too-long')
      await expect(fit('hike')).toHaveText(words.tooLong)
      await expect(fit('tennis')).toHaveAttribute('data-verdict', 'fits')
      await expect(fit('tennis')).toHaveText(words.fits)
      // Item 50's separate warning is gone: one fit line per card.
      for (const id of ['run', 'hike', 'tennis']) {
        await expect(card(id).getByTestId('burn-fit')).toHaveCount(1)
      }
      await expect(page.getByTestId('burn-time-warning')).toHaveCount(0)

      // The hero speaks only when its slot needs sunscreen or is too long.
      const hero = page.getByTestId('hero-slot')
      const heroFit = hero.getByTestId('burn-fit')
      const heroActivity = await hero.getAttribute('data-activity')
      const verdict = await card(heroActivity!).getByTestId('burn-fit').getAttribute('data-verdict')
      if (verdict === 'fits') await expect(heroFit).toHaveCount(0)
      else await expect(heroFit).toHaveAttribute('data-verdict', verdict!)

      await atEachWidth(
        page,
        t,
        `fit-cards-${lang}`,
        page.getByTestId('activity-card').first().locator('..'),
      )
      for (const id of ['run', 'hike', 'tennis']) {
        await atEachWidth(page, t, `fit-card-${id}-${lang}`, card(id))
      }
      await atEachWidth(page, t, `fit-hero-${lang}`, hero)
      await captureScreen(page, t, capture, { name: `burn-fit-${lang}`, fullPage: true })
    })

    test('in a group, the most sensitive skin decides the fit', async ({ page }, t) => {
      const capture = await preparePage(page, t)
      await page.goto('/harness/?screen=dashboard&group=on')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      const run = page.locator('[data-testid="activity-card"][data-activity="run"]')
      const fit = run.getByTestId('recommended-slot').getByTestId('burn-fit')
      // Maya's very fair skin burns in about 30 min at the slot's UV: sunscreen makes it fit,
      // and the card's sunscreen row says how much.
      await expect(fit).toHaveAttribute('data-verdict', 'sunscreen')
      await expect(fit).toHaveText(words.sunscreen)
      await atEachWidth(page, t, `fit-card-run-group-${lang}`, run)
      await captureScreen(page, t, capture, { name: `burn-fit-group-${lang}`, fullPage: true })
    })

    test('the advice line and the sunscreen guidance name the gear for the UV level', async ({
      page,
    }, t) => {
      const capture = await preparePage(page, t)
      await page.goto('/harness/?screen=dashboard')
      await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
      const briefing = page.getByTestId('daily-briefing')
      // The harness day reaches Extreme: shade around midday, and the gear from moderate.
      await expect(briefing.locator('[data-line="tip"]')).toHaveText(words.advice)
      const timer = page.getByRole('region', { name: words.timer })
      await timer.getByText(words.howMuch).click()
      await expect(timer).toContainText(words.gear)
      await atEachWidth(page, t, `fit-briefing-${lang}`, briefing)
      await atEachWidth(page, t, `fit-guide-${lang}`, timer)
      await captureScreen(page, t, capture, { name: `sun-gear-${lang}`, fullPage: true })
    })
  })
}
