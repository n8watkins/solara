import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Firebase messaging service worker', () => {
  it('uses FCM automatic display instead of creating a duplicate notification', () => {
    for (const path of ['scripts/generate-sw.js', 'public/firebase-messaging-sw.js']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source).toContain('firebase.messaging()')
      expect(source).not.toContain('showNotification(')
      expect(source).not.toContain('onBackgroundMessage(')
    }
  })
})
