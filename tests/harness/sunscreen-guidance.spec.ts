import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Sunscreen amount and SPF guidance (ROADMAP item 45, packages/core/src/sunscreen.ts):
// the sunscreen timer's "How much sunscreen" disclosure, the activity card's
// "Sunscreen" row and the Sun profile's SPF rule for the skin type. Each at 320 and
// 390 px (mobile projects) and 1280 px (desktop), light and dark: no sideways scroll,
// nothing cut off, and a clean axe run. SPF_SHOTS=<folder> saves a copy of each.

const SHOTS = process.env.SPF_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const mobile = (t: TestInfo) => t.project.name.startsWith('mobile')
const widths = (t: TestInfo) => (mobile(t) ? [320, 390] : [1280])
const scheme = (t: TestInfo) => t.project.name.split('-')[1]

async function atEachWidth(page: Page, t: TestInfo, name: string, shot: Locator) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  for (const width of widths(t)) {
    await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
    await shot.scrollIntoViewIfNeeded()
    if (SHOTS) {
      await shot.screenshot({
        path: `${SHOTS}/${name}-${width}-${scheme(t)}.png`,
        animations: 'disabled',
        caret: 'hide',
      })
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${name} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    // No line of the guidance is cut off inside its card.
    const clipped = await shot.evaluate(root =>
      [...root.querySelectorAll<HTMLElement>('p, li, span, summary')]
        .filter(
          el =>
            !el.classList.contains('sr-only') &&
            el.scrollWidth > el.clientWidth + 1 &&
            getComputedStyle(el).overflow !== 'visible',
        )
        .map(el => `${el.className}: ${el.textContent}`),
    )
    expect(clipped, `${name} at ${width} px cuts text off`).toEqual([])
  }
}

async function axeClean(page: Page, selector?: string) {
  const builder = new AxeBuilder({ page })
  const axe = await (selector ? builder.include(selector) : builder).analyze()
  expect(axe.violations.map(v => v.id)).toEqual([])
}

const timer = (page: Page) =>
  page.getByRole('region', { name: /Sunscreen timer|Reapply sunscreen|Time to reapply/ })

for (const state of ['idle', 'running'] as const) {
  test(`sunscreen timer, ${state}, how much sunscreen`, async ({ page }, t) => {
    const capture = await preparePage(page, t)
    await page.goto('/harness/?screen=dashboard&tier=guest')
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    if (state === 'running') await timer(page).getByRole('button', { name: 'Start' }).click()
    await timer(page).getByText('How much sunscreen?').click()
    // The harness day's clear-sky peak is Extreme, so SPF 50+ for any skin type.
    await expect(timer(page)).toContainText(
      'SPF 50+ broad spectrum: UV reaches 10.8 (Extreme) today.',
    )
    await expect(timer(page)).toContainText(
      'About 7 teaspoons (35 mL), a shot glass, for your whole body',
    )
    await expect(timer(page)).toContainText('Reapply every 2 h')
    await expect(timer(page)).not.toContainText('\u2014')
    await atEachWidth(page, t, `spf-timer-${state}`, timer(page))
    await axeClean(page, 'section[aria-labelledby]')
    expect(capture.pageErrors).toEqual([])
  })
}

test('activity card, sunscreen amount', async ({ page }, t) => {
  const capture = await preparePage(page, t)
  await page.goto('/harness/?screen=dashboard&tier=free&activities=run,hike,garden')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const card = page.getByTestId('activity-card').and(page.locator('[data-activity="run"]'))
  await expect(card).toBeVisible()
  await expect(card).toContainText('about 5 tsp for face, arms, legs')
  await atEachWidth(page, t, 'spf-activity-card', card)
  await axeClean(page, '[data-testid="activity-card"]')
  expect(capture.pageErrors).toEqual([])
})

test('Sun profile, SPF for the skin type', async ({ page }, t) => {
  const capture = await preparePage(page, t)
  await page.goto('/harness/?screen=settings&tier=free')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const card = dialog.getByTestId('sunscreen-settings')
  await expect(card).toContainText(
    'With type II skin, use SPF 50+ broad spectrum whenever UV is 3 or more.',
  )
  // What else to wear, for any day (ROADMAP item 56).
  await expect(card).toContainText(
    'From UV 3, also wear a shirt, a hat and sunglasses; from UV 8, stay in the shade around midday.',
  )
  await atEachWidth(page, t, 'spf-settings', card)
  // The rule follows the skin type chosen, before it is saved.
  await dialog.getByLabel('Skin type').selectOption('olive')
  await expect(card).toContainText('Use SPF 30+ broad spectrum whenever UV is 3 or more')
  await axeClean(page)
  expect(capture.pageErrors).toEqual([])
})

// The skin type card beside the picker: "Clara · Fitzpatrick Tipo II" once wrapped as
// "Clara ·" / "Fitzpatrick Tipo" / "II" at 320 px in Spanish. The type label stays whole and
// the dot stays with the name, for every skin type, in both languages.
for (const lang of ['en', 'es'] as const) {
  test(`Sun profile, the skin type card keeps its Fitzpatrick label whole (${lang})`, async ({
    page,
  }, t) => {
    const capture = await preparePage(page, t)
    await page.addInitScript(language => {
      try {
        window.localStorage.setItem('solara_language', language)
      } catch {}
    }, lang)
    await page.goto('/harness/?screen=settings&tier=free')
    await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
    const dialog = page.getByRole('dialog', { name: lang === 'en' ? 'Settings' : 'Configuración' })
    const label = dialog.getByTestId('skin-fitzpatrick')
    const picker = dialog.getByLabel(lang === 'en' ? 'Skin type' : 'Tipo de piel')
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    for (const width of widths(t)) {
      await page.setViewportSize({ width, height: mobile(t) ? 844 : 900 })
      for (const skin of ['very-fair', 'fair', 'medium', 'olive', 'dark']) {
        await picker.selectOption(skin)
        const at = `${skin} at ${width} px (${lang})`
        const shape = await label.evaluate(el => {
          const lineOf = (node: Node) => {
            const range = document.createRange()
            range.selectNodeContents(node)
            const rect = range.getClientRects()[0]!
            return rect.top + rect.height / 2
          }
          // The name is the line's first text, and the dot the text just before the label.
          const name = el.parentElement!.parentElement!.firstChild!
          const dot = el.previousSibling!
          return {
            lines: new Set([...el.getClientRects()].map(r => Math.round(r.top))).size,
            apart: Math.abs(lineOf(dot) - lineOf(name)),
          }
        })
        expect(shape.lines, `the Fitzpatrick label breaks for ${at}`).toBe(1)
        expect(shape.apart, `the dot leaves the name for ${at}`).toBeLessThan(4)
      }
      if (SHOTS) {
        await dialog
          .getByTestId('skin-fitzpatrick')
          .locator('xpath=ancestor::div[2]')
          .screenshot({
            path: `${SHOTS}/skin-card-${lang}-${width}-${scheme(t)}.png`,
            animations: 'disabled',
            caret: 'hide',
          })
      }
    }
    await axeClean(page)
    expect(capture.pageErrors).toEqual([])
  })
}
