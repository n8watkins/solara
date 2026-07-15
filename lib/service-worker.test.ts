import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Firebase messaging service worker', () => {
  it('generates a worker that deduplicates data messages before displaying them', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/generate-sw.js'),
      'utf8',
    )
    expect(source).toContain('firebase.messaging()')
    expect(source).toContain('solara-notification-deliveries-v1')
    expect(source).toContain('caches.open(')
    expect(source).toContain('cache.match(marker)')
    expect(source).toContain('cache.put(marker')
    expect(source).toContain("deliveryScope + ':' + deliveryKey")
    expect(source).toContain('showNotification(')
    expect(source).toContain('onBackgroundMessage(')
  })
})
