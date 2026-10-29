// The reapply reminder push and the daily UV push without Firestore: which records count
// as a waiting reminder, what the pushes look like on web and Android, and the switch.
// The full flows (trigger, task, sweep, caps, daily UV runs) are in
// test/emulator/reminders.test.js and test/emulator/alerts.test.js.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const { Timestamp } = require('firebase-admin/firestore')
const { deliveryScope, messageFor } = require('../lib/notifications/alerts')
const {
  parseReminder,
  reapplyDeliveryKey,
  reminderWritten,
} = require('../lib/notifications/reminders')

const NOW = Date.parse('2026-06-15T17:00:00Z')
const MINUTE = 60_000
const ID = '0123456789abcdef0123456789abcdef'

function record({ mode = 'standard', appliedAt = NOW, minutes = 120, ...rest } = {}) {
  const remindAt = appliedAt + minutes * MINUTE
  return {
    id: ID,
    mode,
    appliedAt: Timestamp.fromMillis(appliedAt),
    remindAt: Timestamp.fromMillis(remindAt),
    dueAt: Timestamp.fromMillis(remindAt),
    expireAt: Timestamp.fromMillis(remindAt + 1440 * MINUTE),
    ...rest,
  }
}

describe('a waiting reapply reminder', () => {
  test('is the record the rules allow: the reminder one interval after the application', () => {
    assert.deepEqual(parseReminder(record()), {
      id: ID,
      mode: 'standard',
      remindAt: NOW + 120 * MINUTE,
      dueAt: NOW + 120 * MINUTE,
    })
    assert.equal(parseReminder(record({ mode: 'water', minutes: 80 }))?.remindAt, NOW + 80 * MINUTE)
  })

  test('anything else is not sent', () => {
    assert.equal(parseReminder(undefined), null)
    assert.equal(parseReminder(record({ id: 'short' })), null)
    assert.equal(parseReminder(record({ mode: 'sauna' })), null)
    // A reminder time that is not the mode's interval.
    assert.equal(parseReminder(record({ mode: 'water', minutes: 120 })), null)
    assert.equal(parseReminder(record({ minutes: 5 })), null)
    // Claimed (no dueAt): no longer waiting.
    const { dueAt: _dueAt, ...claimed } = record()
    assert.equal(parseReminder(claimed), null)
  })

  test('does nothing while the alerts are off, or for a record that is not waiting', async () => {
    const db = new Proxy({}, { get: () => assert.fail('no Firestore access expected') })
    const enqueue = () => assert.fail('nothing should be enqueued')
    const base = { db, uid: 'alice', before: undefined, enqueue, nowMs: NOW }
    assert.equal(await reminderWritten({ ...base, after: record(), enabled: false }), 'off')
    assert.equal(await reminderWritten({ ...base, after: undefined, enabled: true }), 'not-waiting')
    const { dueAt: _dueAt, ...claimed } = record()
    assert.equal(await reminderWritten({ ...base, after: claimed, enabled: true }), 'not-waiting')
  })
})

describe('reminder and daily UV pushes', () => {
  const alert = {
    title: 'Time to reapply sunscreen',
    body: 'It has been 2 hours since you put it on.',
  }
  const reapply = {
    kind: 'reapply',
    field: 'reapply',
    day: '2026-06-15',
    key: reapplyDeliveryKey(ID),
  }

  test('the delivery scope is unchanged since it moved to core', () => {
    const node = createHash('sha256')
      .update('solara-notification:alice')
      .digest('base64url')
      .slice(0, 22)
    assert.equal(deliveryScope('alice'), node)
  })

  test('a reminder is urgent on the web and carries the tag the browser timer uses', () => {
    const message = messageFor(
      reapply,
      'alice',
      { token: 't', platform: 'web' },
      alert,
      'https://x',
    )
    assert.equal(message.webpush.headers.Urgency, 'high')
    assert.equal(message.data.deliveryKey, `reapply-v1:${ID}`)
    assert.equal(message.data.deliveryScope, deliveryScope('alice'))
    assert.equal(message.android.notification, undefined)
  })

  test('Android gets a visible high-priority notification on the alerts channel', () => {
    const message = messageFor(
      reapply,
      'alice',
      { token: 't', platform: 'android' },
      alert,
      'https://x',
    )
    assert.equal(message.android.priority, 'high')
    assert.equal(message.android.notification.channelId, 'solara-alerts')
    assert.equal(message.android.notification.title, alert.title)
    assert.equal(message.android.notification.tag, `reapply-v1:${ID}`)
  })

  test('the daily UV push can wait for a phone to wake, like the morning alert', () => {
    const basic = { kind: 'basic', field: 'basic', day: '2026-06-15', key: 'basic-v1:2026-06-15' }
    const message = messageFor(basic, 'alice', { token: 't', platform: 'web' }, alert, 'https://x')
    assert.equal(message.webpush.headers.Urgency, 'normal')
  })
})
