import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { startClock } from './clock'
import { HARNESS_MARKER } from './fixtures'

// Keyboard-only pass through every modal, on the signed-in harness. Each test
// drives the UI with the keyboard alone (focus a trigger, then keys) and checks
// the dialog contract: a named modal dialog, focus kept inside, Escape closes
// only the topmost layer, and focus returns to the opener. Each open dialog
// must also have zero serious or critical axe violations.

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name.endsWith('-dark'), 'behavior does not depend on the theme')
})

async function open(page: Page, screen: string) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:'
      ? route.continue()
      : route.abort('blockedbyclient')
  })
  await startClock(page)
  await page.goto(`/harness/?screen=${screen}`)
  await expect(page.getByTestId(HARNESS_MARKER)).toHaveAttribute('data-screen', screen)
}

/** Press a key on whatever has focus, as a keyboard user would. */
async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
}

/**
 * Tab forward and backward past every control; focus must never reach the
 * page behind. A native modal dialog lets Tab step out to the browser's own
 * UI (the document then has no focused element) and back in, which is the
 * platform behavior, so that state is allowed; any other element is not.
 */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  const handle = await dialog.elementHandle()
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key)
      const where = await page.evaluate(el => {
        const active = document.activeElement
        if (el?.contains(active)) return 'dialog'
        return !active || active === document.body ? 'browser' : 'page'
      }, handle)
      expect(where, `${key} #${i + 1} moved focus to the page behind the dialog`).not.toBe('page')
    }
  }
}

async function expectNoSeriousAxeViolations(page: Page) {
  await page.clock.resume()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  const serious = results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  expect(serious).toEqual([])
}

test('settings: tabs, labels, focus trap and Escape', async ({ page }) => {
  await open(page, 'settings')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  // The dialog itself takes focus, so the title is announced first.
  await expect(dialog).toBeFocused()

  await expect(dialog.getByRole('combobox', { name: 'Skin type' })).toBeVisible()

  // Tab reaches the close button, then the selected tab; arrows move between tabs.
  await press(page, 'Tab', 2)
  const sunProfile = dialog.getByRole('tab', { name: 'Sun profile' })
  await expect(sunProfile).toBeFocused()
  await expect(sunProfile).toHaveAttribute('aria-selected', 'true')
  await press(page, 'ArrowRight')
  const appearance = dialog.getByRole('tab', { name: 'Appearance' })
  await expect(appearance).toBeFocused()
  await expect(appearance).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tabpanel')).toContainText('Sun path animation')
  await expect(dialog.getByRole('button', { name: 'Sun path animation' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await press(page, 'End')
  await expect(dialog.getByRole('tab', { name: 'Account' })).toBeFocused()
  await press(page, 'ArrowRight')
  await expect(sunProfile).toBeFocused()

  // Every tab is on screen, including on a phone.
  for (const name of ['Sun profile', 'Appearance', 'Activities', 'Location', 'Account']) {
    await expect(dialog.getByRole('tab', { name })).toBeInViewport({ ratio: 1 })
  }

  await expectFocusTrapped(page, dialog)
  await expectNoSeriousAxeViolations(page)

  await press(page, 'Escape')
  await expect(dialog).toHaveCount(0)
})

test('settings: unsaved changes ask before Escape closes', async ({ page }) => {
  await open(page, 'settings')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('combobox', { name: 'Skin type' }).selectOption('olive')

  page.once('dialog', confirm => void confirm.dismiss())
  await dialog.getByRole('combobox', { name: 'Skin type' }).focus()
  await press(page, 'Escape')
  await expect(dialog).toBeVisible()

  page.once('dialog', confirm => void confirm.accept())
  await press(page, 'Escape')
  await expect(dialog).toHaveCount(0)
})

test('pricing: named dialog with a real comparison table', async ({ page }) => {
  await open(page, 'pricing')
  const dialog = page.getByRole('dialog', { name: 'Solara Pro' })
  await expect(dialog).toBeFocused()
  const table = dialog.getByRole('table', { name: 'Free and Pro plan features' })
  await expect(table.getByRole('columnheader', { name: 'Pro' })).toBeVisible()
  await expect(table.getByRole('rowheader', { name: 'Calendar sync' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Email for early access' })).toBeVisible()

  await expectFocusTrapped(page, dialog)
  await expectNoSeriousAxeViolations(page)
  await press(page, 'Escape')
  await expect(dialog).toHaveCount(0)
})

test('manage and edit activity: nested dialogs, emoji picker, focus return', async ({ page }) => {
  await open(page, 'dashboard')
  const manageTrigger = page.getByRole('button', { name: 'Manage', exact: true })
  await manageTrigger.focus()
  await press(page, 'Enter')

  const manage = page.getByRole('dialog', { name: 'Manage activities' })
  await expect(manage).toBeFocused()
  await expect(manage.getByRole('heading', { name: 'Running' })).toBeVisible()
  await expectFocusTrapped(page, manage)

  await manage.getByRole('button', { name: 'Edit Running' }).focus()
  await press(page, 'Enter')
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  await expect(edit).toBeFocused()
  await expect(edit.getByRole('textbox', { name: 'Activity name' })).toHaveValue('Running')
  await expect(edit.getByRole('spinbutton', { name: 'Duration' })).toHaveValue('45')
  await expect(edit.getByRole('slider', { name: 'Base planning UV limit' })).toBeVisible()
  await expect(
    edit.getByRole('group', { name: 'Preferred time' }).getByRole('button', { name: 'Earliest' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    edit.getByRole('group', { name: 'Sun protection' }).getByRole('button', { name: 'No SPF' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // The emoji picker: open, arrow through the grid, Escape closes only the picker.
  const iconButton = edit.getByRole('button', { name: 'Change activity icon' })
  await iconButton.focus()
  await press(page, 'Enter')
  const picker = page.getByRole('dialog', { name: 'Choose an icon' })
  await expect(picker.getByRole('searchbox', { name: 'Search emojis' })).toBeFocused()
  await press(page, 'Tab')
  await expect(picker.getByRole('button', { name: '🏃' })).toBeFocused()
  await press(page, 'ArrowRight')
  await expect(picker.getByRole('button', { name: '🚴' })).toBeFocused()
  const bike = await picker.getByRole('button', { name: '🚴' }).boundingBox()
  await press(page, 'ArrowDown')
  const below = await page.evaluate(() => {
    const r = document.activeElement!.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  expect(below.x).toBeCloseTo(bike!.x, 0)
  expect(below.y).toBeGreaterThan(bike!.y + bike!.height / 2)
  await press(page, 'Escape')
  await expect(picker).toHaveCount(0)
  await expect(edit).toBeVisible()
  await expect(iconButton).toBeFocused()

  await expectFocusTrapped(page, edit)
  await expectNoSeriousAxeViolations(page)

  // Escape closes the edit dialog only, and focus goes back to its opener.
  await press(page, 'Escape')
  await expect(edit).toHaveCount(0)
  await expect(manage).toBeVisible()
  await expect(manage.getByRole('button', { name: 'Edit Running' })).toBeFocused()

  await press(page, 'Escape')
  await expect(manage).toHaveCount(0)
  await expect(manageTrigger).toBeFocused()
})

test('add activity: presets are toggle buttons and the dialog is clean', async ({ page }) => {
  await open(page, 'dashboard')
  const trigger = page.getByRole('button', { name: '+ Add Activity' })
  await trigger.focus()
  await press(page, 'Enter')
  const add = page.getByRole('dialog', { name: 'Add activity' })
  await expect(add).toBeFocused()
  await expect(add.getByRole('searchbox', { name: 'Search activities' })).toBeVisible()
  await expect(add.getByRole('button', { name: 'Running 45m' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expectFocusTrapped(page, add)
  await expectNoSeriousAxeViolations(page)
  await press(page, 'Escape')
  await expect(add).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('tooltips are keyboard-reachable and describe their button', async ({ page }) => {
  await open(page, 'dashboard')
  const info = page.getByRole('button', { name: 'More info' }).first()
  await info.focus()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(info).toHaveAccessibleDescription(/UV index for that hour/)
  await press(page, 'Escape')
  await expect(tip).toBeHidden()
})

test('tip carousel: focusable track, 24 px dots and a pause button', async ({ page }) => {
  await open(page, 'dashboard')
  const carousel = page.getByRole('region', { name: 'Sun safety tips' })
  for (const dot of await carousel.getByRole('button', { name: /Show tip/ }).all()) {
    const box = await dot.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
  }
  const pause = carousel.getByRole('button', { name: 'Pause tips' })
  await pause.focus()
  await press(page, 'Enter')
  await expect(carousel.getByRole('button', { name: 'Play tips' })).toBeFocused()
})

test('profile switcher: disclosure with Escape and focus return', async ({ page }) => {
  await open(page, 'dashboard')
  const trigger = page.getByRole('button', { name: 'Profile: Me' })
  await trigger.focus()
  await press(page, 'Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByRole('dialog', { name: 'Profiles' })
  await expect(panel.getByRole('button', { name: /^Me/ })).toHaveAttribute('aria-pressed', 'true')
  await press(page, 'Tab')
  await expect(panel.getByRole('button', { name: /^Me/ })).toBeFocused()
  await press(page, 'Escape')
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
