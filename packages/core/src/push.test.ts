import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deliveryScope, reapplyDeliveryKey, reapplyReminderTag } from './push'
import { isReminderTag } from './reapply'

describe('delivery scope', () => {
  it('matches the scope the Functions sent before it moved to core', () => {
    for (const uid of ['alice', 'u'.repeat(28), 'Zx9-é']) {
      const node = createHash('sha256')
        .update(`solara-notification:${uid}`)
        .digest('base64url')
        .slice(0, 22)
      expect(deliveryScope(uid)).toBe(node)
    }
  })

  it('never contains the account id', () => {
    expect(deliveryScope('alice')).not.toContain('alice')
    expect(deliveryScope('alice')).not.toBe(deliveryScope('bob'))
  })

  it('tags a reapply reminder the way the timer reads it', () => {
    const id = '0123456789abcdef0123456789abcdef'
    expect(reapplyDeliveryKey(id)).toBe(`reapply-v1:${id}`)
    const tag = reapplyReminderTag('alice', id)
    expect(tag).toBe(`${deliveryScope('alice')}:reapply-v1:${id}`)
    expect(isReminderTag(tag)).toBe(true)
  })
})
