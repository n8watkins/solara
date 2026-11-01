import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { type Account, expect, openDashboard, test } from './fixtures'

// An account on Automatic gets its pushes in its own language (ROADMAP item 46): the app
// saves the language it resolves from the device to the account (`deviceLanguage`, only
// when it changes, so the last device to open the app wins), and the server writes the
// push in it (packages/core/src/server-language.ts). Before, the server never saw the
// device and wrote English.
//
// The browser half runs the real app against the emulators and the real rules; the
// server half runs the real reminder delivery (functions/lib, built by run.mjs) on the
// same Firestore emulator, with a stand-in for Firebase Cloud Messaging.

const functionsRequire = createRequire(resolve('functions/package.json'))

interface PushMessage {
  token: string
  data: Record<string, string>
}

/** Firebase Cloud Messaging's sendEach, keeping what would have been sent. */
class FakeMessaging {
  sent: PushMessage[] = []

  async sendEach(messages: PushMessage[]) {
    this.sent.push(...messages)
    const responses = messages.map(() => ({ success: true, messageId: 'id' }))
    return { responses, successCount: responses.length, failureCount: 0 }
  }
}

/** The server's view of the emulators: the Admin SDK and the reminder delivery. */
function server() {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${process.env.SIGNED_IN_FIRESTORE_PORT}`
  const { getApps, initializeApp } = functionsRequire('firebase-admin/app')
  const { Timestamp, getFirestore } = functionsRequire('firebase-admin/firestore')
  const { tokenOwnerId } = functionsRequire('./lib/notifications/devices')
  const { deliverReapplyReminder } = functionsRequire('./lib/notifications/reminders')
  const name = 'device-language-e2e'
  const app =
    getApps().find((a: { name: string }) => a.name === name) ??
    initializeApp({ projectId: process.env.SIGNED_IN_PROJECT }, name)
  return { db: getFirestore(app), Timestamp, tokenOwnerId, deliverReapplyReminder }
}

/** Sends the account its reapply reminder as its Cloud Tasks task would, and returns it. */
async function reapplyPush(account: Account): Promise<PushMessage> {
  const { db, Timestamp, tokenOwnerId, deliverReapplyReminder } = server()
  const user = db.collection('users').doc(account.uid)
  const token = `${account.uid}-device-language-token`
  await user
    .collection('notificationDevices')
    .doc('d'.repeat(36))
    .set({ token, enabled: true, platform: 'web' })
  await db
    .collection('notificationTokenOwners')
    .doc(tokenOwnerId(token))
    .set({ uid: account.uid, deviceId: 'd'.repeat(36) })
  // The record the timer writes (lib/reapply-reminder.ts), as the rules accept it; a new
  // schedule each time, as each Start is.
  const id = randomBytes(16).toString('hex')
  const appliedAt = Date.now()
  const remindAt = appliedAt + 120 * 60_000
  await user
    .collection('reminders')
    .doc('reapply')
    .set({
      id,
      mode: 'standard',
      appliedAt: Timestamp.fromMillis(appliedAt),
      remindAt: Timestamp.fromMillis(remindAt),
      dueAt: Timestamp.fromMillis(remindAt),
      expireAt: Timestamp.fromMillis(remindAt + 24 * 3_600_000),
    })
  const messaging = new FakeMessaging()
  const deps = { db, messaging, appUrl: 'https://solara.example', now: () => remindAt }
  expect(await deliverReapplyReminder(deps, account.uid, id)).toBe('sent')
  expect(messaging.sent).toHaveLength(1)
  return messaging.sent[0]!
}

test('an Automatic account on a Spanish device stores Spanish and gets its push in Spanish', async ({
  page,
  emulators,
  blockedRequests,
}) => {
  const account = await emulators.createAccount('Lucía Ortega')
  // Language never chosen: Automatic.
  await emulators.seedPrefs(account)
  expect((await emulators.readPrefs(account))?.language).toBeUndefined()

  // An English device opens the account first: it stores English, and the push is English.
  await openDashboard(page, account)
  await expect.poll(async () => (await emulators.readPrefs(account))?.deviceLanguage).toBe('en')
  expect((await reapplyPush(account)).data.title).toBe('Time to reapply sunscreen')

  // Then a Spanish device (es-MX first in its languages) opens it: the last one wins.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['es-MX', 'es', 'en'] })
    Object.defineProperty(navigator, 'language', { get: () => 'es-MX' })
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('toolbar', { name: 'Pronóstico UV por hora' })).toBeVisible()
  await expect.poll(async () => (await emulators.readPrefs(account))?.deviceLanguage).toBe('es')
  const stored = await emulators.readPrefs(account)
  // The choice in Settings still means Automatic, and only the resolved language is kept.
  expect(stored?.language).toBeUndefined()
  expect(stored?.deviceLanguage).toBe('es')

  // The server now writes the account's push in Spanish.
  const push = await reapplyPush(account)
  expect(push.data.title).toBe('Es hora de volver a aplicar protector solar')
  expect(push.data.body).toBe('Han pasado 2 horas desde que te lo aplicaste.')

  // Opening again on the same device leaves the account alone: the field is unchanged.
  const { db } = server()
  const accountDoc = db.collection('users').doc(account.uid)
  const before = (await accountDoc.get()).updateTime.toMillis()
  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Pronóstico UV por hora' })).toBeVisible()
  // Long enough for the write the app would have made after loading the account.
  await page.waitForTimeout(1_500)
  expect((await accountDoc.get()).updateTime.toMillis()).toBe(before)

  expect(blockedRequests, 'requests that tried to leave the machine').toEqual([])
})
