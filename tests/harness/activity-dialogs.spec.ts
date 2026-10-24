import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { pauseClock, startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Screenshots and a strict axe check for every state of the activity dialogs:
// Add activity (browse, the custom form, My activities), Manage activities,
// Edit activity (top, bottom and the emoji picker) and the Activities tab of
// Settings. Each flow runs twice: once with the clock paused to record
// screenshots for before and after evidence (like ui-harness.spec.ts), and once
// with the clock running, because axe-core needs timers, where any axe
// violation fails the test.
const SHOT_DIR = join('test-results', 'ui-harness', 'screenshots')

type Mode = 'shots' | 'axe'

async function open(page: Page, screen: string, colorScheme: 'light' | 'dark', mode: Mode) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:'
      ? route.continue()
      : route.abort('blockedbyclient')
  })
  await startClock(page)
  await page.addInitScript(theme => {
    try {
      window.localStorage.setItem('solara_theme', theme)
    } catch {}
  }, colorScheme)
  await page.goto(`/harness/?screen=${screen}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', screen)
  if (mode === 'shots') await pauseClock(page)
}

async function shoot(page: Page, name: string, project: string) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({
    path: join(SHOT_DIR, `${name}--${project}.png`),
    animations: 'disabled',
    caret: 'hide',
  })
}

async function expectNoAxeViolations(page: Page, include: Locator) {
  const selector = await include.evaluate(el => {
    el.setAttribute('data-axe-scope', '')
    return '[data-axe-scope]'
  })
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  await include.evaluate(el => el.removeAttribute('data-axe-scope'))
  expect(
    results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`),
  ).toEqual([])
}

/** Screenshot the page in `shots` mode, or axe-check `scope` in `axe` mode. */
function checkpoint(page: Page, mode: Mode, project: string) {
  return async (name: string, scope: Locator) => {
    if (mode === 'shots') await shoot(page, name, project)
    else await expectNoAxeViolations(page, scope)
  }
}

function scheme(project: string): 'light' | 'dark' {
  return project.endsWith('-dark') ? 'dark' : 'light'
}

async function scrollDialogBody(dialog: Locator, to: 'top' | 'bottom') {
  await dialog.evaluate((el, where) => {
    for (const node of el.querySelectorAll<HTMLElement>('*')) {
      if (node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY === 'auto')
        node.scrollTop = where === 'top' ? 0 : node.scrollHeight
    }
  }, to)
}

for (const mode of ['shots', 'axe'] as const) {
  test(`add activity dialog states (${mode})`, async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const at = checkpoint(page, mode, project)
    await open(page, 'dashboard', scheme(project), mode)
    await page.getByRole('button', { name: '+ Add Activity' }).click()
    const add = page.getByRole('dialog', { name: 'Add activity' })
    await expect(add.getByRole('searchbox', { name: 'Search activities' })).toBeVisible()
    await at('activity-add-browse', add)

    await add.getByRole('button', { name: '+ Create custom activity' }).click()
    await expect(add.getByRole('textbox', { name: 'Activity name' })).toBeVisible()
    await add.getByRole('textbox', { name: 'Activity name' }).fill('Paddleboard')
    await add.getByRole('group', { name: 'Sun protection' }).getByText('SPF 30+').click()
    await at('activity-add-create', add)

    await add.getByRole('button', { name: /^My activities/ }).click()
    await expect(add.getByRole('group', { name: 'Running sun protection' })).toBeVisible()
    await at('activity-add-mine', add)
  })

  test(`manage and edit activity dialogs (${mode})`, async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const at = checkpoint(page, mode, project)
    await open(page, 'dashboard', scheme(project), mode)
    await page.getByRole('button', { name: 'Manage', exact: true }).click()
    const manage = page.getByRole('dialog', { name: 'Manage activities' })
    await expect(manage.getByRole('heading', { name: 'Running' })).toBeVisible()
    await at('activity-manage', manage)

    await manage.getByRole('button', { name: 'Edit Running' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit activity' })
    await expect(edit.getByRole('textbox', { name: 'Activity name' })).toHaveValue('Running')
    await edit.getByRole('button', { name: 'Any time' }).click()
    await scrollDialogBody(edit, 'top')
    await at('activity-edit-top', edit)

    // Screenshot only: axe counts labels scrolled out of the body as hidden,
    // and the whole dialog was already checked at the top.
    if (mode === 'shots') {
      await scrollDialogBody(edit, 'bottom')
      await shoot(page, 'activity-edit-bottom', project)
      await scrollDialogBody(edit, 'top')
    }

    await edit.getByRole('button', { name: 'Change activity icon' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose an icon' })
    await expect(picker.getByRole('searchbox', { name: 'Search emojis' })).toBeFocused()
    await picker.getByRole('button', { name: '🚴' }).hover()
    await at('activity-edit-emoji', picker)
  })

  test(`settings activities tab (${mode})`, async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const at = checkpoint(page, mode, project)
    await open(page, 'settings', scheme(project), mode)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Activities' }).click()
    const panel = dialog.getByRole('tabpanel')
    await expect(panel.getByRole('group', { name: 'Preset categories' })).toBeVisible()
    await at('activity-settings', panel)
  })
}

test('emoji search finds icons by word and says when nothing matches', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', 'behavior does not depend on the viewport')
  await open(page, 'dashboard', 'light', 'axe')
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Manage activities' })
    .getByRole('button', { name: 'Edit Running' })
    .click()
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  await edit.getByRole('button', { name: 'Change activity icon' }).click()
  const picker = page.getByRole('dialog', { name: 'Choose an icon' })
  const search = picker.getByRole('searchbox', { name: 'Search emojis' })

  await search.fill('bike')
  const results = picker.getByRole('group', { name: 'Search results' })
  await expect(results.getByRole('button')).toHaveText(['🚴', '🚵'])
  await results.getByRole('button', { name: '🚵' }).click()
  await expect(picker).toHaveCount(0)
  await expect(edit.getByRole('button', { name: 'Change activity icon' })).toHaveText('🚵')

  await edit.getByRole('button', { name: 'Change activity icon' }).click()
  await search.fill('zzz')
  await expect(picker.getByRole('status')).toHaveText('No icons match "zzz".')
})
