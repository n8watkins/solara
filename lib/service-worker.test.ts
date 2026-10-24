import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'scripts/sw/firebase-messaging-sw.ts'), 'utf8')
const generator = readFileSync(resolve(process.cwd(), 'scripts/generate-sw.js'), 'utf8')

describe('Firebase messaging service worker', () => {
  it('deduplicates data messages before displaying them', () => {
    expect(source).toContain('onBackgroundMessage(')
    expect(source).toContain('solara-notification-deliveries-v1')
    expect(source).toContain('cache.match(marker)')
    expect(source).toContain('cache.put(marker')
    expect(source).toContain("deliveryScope + ':' + deliveryKey")
    expect(source).toContain('showNotification(')
  })

  it('is bundled from npm Firebase instead of loading scripts from a CDN', () => {
    expect(source).toContain("from 'firebase/messaging/sw'")
    expect(source + generator).not.toMatch(/importScripts|gstatic\.com|firebase-[a-z]+-compat/)
    expect(generator).toContain("import('rolldown')")
  })

  it('resolves the Firebase config from the same env files as Next', () => {
    expect(generator).toContain("require('@next/env')")
    expect(generator).toContain('loadEnvConfig(')
    expect(generator).not.toContain('dotenv')
  })

  it('only opens same-origin links and reuses an open window', () => {
    expect(source).toContain('safeNotificationUrl(')
    expect(source).toContain('chooseWindowClient(')
    expect(source).toContain('.focus()')
  })
})
