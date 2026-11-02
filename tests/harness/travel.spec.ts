import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { captureScreen, preparePage, type Capture } from './capture'
import { HARNESS_MARKER } from './fixtures'

// The place that follows the phone (ROADMAP item 54) in English and Spanish, light and
// dark: the travel prompt above the dashboard, the header during a visit, and the place
// menu at home and during a visit, each with an axe report, at the project's width and at
// 320 and 390 px or 1280 px, without sideways scrolling and with the menu inside the
// screen. TRAVEL_SHOTS=<folder> saves each width.

const SHOTS = process.env.TRAVEL_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

const LANGUAGES = [
  {
    code: 'en',
    banner: /You seem to be in Ciudad de México\. Show UV here\?/,
    visiting: 'Visiting San Diego, home is Los Angeles',
    places: 'Places',
    back: 'Back to Los Angeles',
    setHome: 'Set as home',
  },
  {
    code: 'es',
    banner: /Parece que estás en Ciudad de México\. ¿Mostrar el UV de aquí\?/,
    visiting: 'De visita en San Diego, tu casa es Los Angeles',
    places: 'Lugares',
    back: 'Volver a Los Angeles',
    setHome: 'Usar como casa',
  },
] as const

async function open(page: Page, t: TestInfo, code: string, query: string): Promise<Capture> {
  const capture = await preparePage(page, t)
  await page.addInitScript(language => {
    try {
      window.localStorage.setItem('solara_language', language)
    } catch {}
  }, code)
  await page.goto(`/harness/?screen=dashboard&${query}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  return capture
}

/** No sideways scrolling, the menu (when open) inside the screen, and a copy per width. */
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
    const layout = await page.evaluate(() => {
      const menu = document.querySelector('[data-testid="place-menu"]')
      const box = menu?.getBoundingClientRect()
      return {
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        menu: box ? { left: box.left, right: box.right } : null,
        // Every control inside the menu stays inside it.
        spill: menu
          ? [...menu.querySelectorAll('button, input')].some(el => {
              const inner = el.getBoundingClientRect()
              return inner.left < box!.left - 0.5 || inner.right > box!.right + 0.5
            })
          : false,
      }
    })
    expect(layout.scroll, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    if (layout.menu) {
      expect(layout.menu.left).toBeGreaterThanOrEqual(0)
      expect(layout.menu.right).toBeLessThanOrEqual(width)
    }
    expect(layout.spill, `${name} at ${width} px spills out of the menu`).toBe(false)
  }
  await page.setViewportSize(t.project.use.viewport!)
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang.code}`, () => {
    test('the travel prompt above the dashboard', async ({ page }, testInfo) => {
      const capture = await open(page, testInfo, lang.code, 'travel=ciudad-de-mexico')
      const banner = page.getByTestId('travel-banner')
      await expect(banner).toHaveText(lang.banner)
      // Both buttons stay on screen and in the banner at every width.
      await atEachWidth(page, testInfo, `travel-banner-${lang.code}`)
      await captureScreen(page, testInfo, capture, {
        name: `travel-banner-${lang.code}`,
        fullPage: false,
      })
    })

    test('a visit: the header and the place menu', async ({ page }, testInfo) => {
      const capture = await open(page, testInfo, lang.code, 'visit=san-diego')
      const place = page.getByRole('button', { name: lang.visiting })
      await expect(place).toBeVisible()
      await expect(page.getByTestId('header-place-name')).toHaveText('San Diego')
      await atEachWidth(page, testInfo, `travel-visit-header-${lang.code}`)
      await place.click()
      const menu = page.getByRole('dialog', { name: lang.places })
      await expect(menu.getByRole('button', { name: lang.back })).toBeFocused()
      await expect(menu.getByRole('button', { name: lang.setHome })).toBeVisible()
      await atEachWidth(page, testInfo, `travel-visit-menu-${lang.code}`)
      await captureScreen(page, testInfo, capture, {
        name: `travel-visit-menu-${lang.code}`,
        fullPage: false,
      })
    })

    test('the place menu at home', async ({ page }, testInfo) => {
      const capture = await open(page, testInfo, lang.code, '')
      await page.getByTestId('header-place-name').click()
      const menu = page.getByRole('dialog', { name: lang.places })
      await expect(menu).toBeVisible()
      await expect(menu.locator('[aria-current="true"]')).toHaveCount(1)
      await atEachWidth(page, testInfo, `travel-home-menu-${lang.code}`)
      await captureScreen(page, testInfo, capture, {
        name: `travel-home-menu-${lang.code}`,
        fullPage: false,
      })
    })
  })
}
