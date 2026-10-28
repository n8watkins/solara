import { expect, test } from '@playwright/test'
import { captureScreen, preparePage } from './capture'
import { HARNESS_MARKER } from './fixtures'

// Skin typing in Settings: the Fitzpatrick type beside each skin type, and the
// optional quiz (components/SkinTypeQuiz.tsx) that suggests one. Screenshots and axe
// reports go to test-results/ui-harness/ like the other harness specs.

test('settings sun profile with Fitzpatrick types', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.goto('/harness/?screen=settings')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('combobox', { name: 'Skin type' })).toHaveValue('fair')
  await expect(dialog.getByRole('option', { name: 'Fair (Type II)' })).toBeAttached()
  await expect(dialog.getByText('· Fitzpatrick Type II')).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'settings-skin-type', fullPage: false })
})

test('skin type quiz from Settings', async ({ page }, testInfo) => {
  const capture = await preparePage(page, testInfo)
  await page.goto('/harness/?screen=settings')
  await expect(page.getByTestId(HARNESS_MARKER)).toBeVisible()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Not sure? Take the 1-minute quiz' }).click()
  const quiz = page.getByRole('dialog', { name: 'Find your skin type' })
  await expect(quiz).toBeVisible()
  await captureScreen(page, testInfo, capture, { name: 'skin-quiz-start', fullPage: false })

  const answers: [RegExp, string][] = [
    [/What color is your skin/, 'Pale with a beige tint'],
    [/freckles/, 'A few'],
    [/too long/, 'Sometimes a burn, then peeling'],
    [/How much do you tan/, 'A reasonable tan'],
    [/your face/, 'Normal'],
  ]
  for (const [question, answer] of answers) {
    await quiz.getByRole('group', { name: question }).getByLabel(answer).check()
  }
  await expect(quiz.getByRole('status')).toHaveText('Your answers suggest Type III, Medium.')
  await captureScreen(page, testInfo, capture, { name: 'skin-quiz-result', fullPage: false })

  // Using it changes the Settings draft only; Settings still saves as usual.
  await quiz.getByRole('button', { name: 'Use Medium' }).click()
  await expect(quiz).toHaveCount(0)
  await expect(settings.getByRole('combobox', { name: 'Skin type' })).toHaveValue('medium')
})
