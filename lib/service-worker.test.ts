import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Firebase messaging service worker', () => {
  it('deduplicates data messages before displaying them', () => {
    for (const path of ['scripts/generate-sw.js', 'public/firebase-messaging-sw.js']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source).toContain('firebase.messaging()')
      expect(source).toContain('solara-notification-deliveries-v1')
      expect(source).toContain('caches.open(')
      expect(source).toContain('cache.match(marker)')
      expect(source).toContain('cache.put(marker')
      expect(source).toContain('showNotification(')
      expect(source).toContain('onBackgroundMessage(')
    }
  })
})
