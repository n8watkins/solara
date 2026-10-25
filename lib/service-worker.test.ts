import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'scripts/sw/firebase-messaging-sw.ts'), 'utf8')
const generator = readFileSync(resolve(process.cwd(), 'scripts/build-sw.mjs'), 'utf8')
const shell = readFileSync(resolve(process.cwd(), 'scripts/sw/shell.ts'), 'utf8')
const register = readFileSync(resolve(process.cwd(), 'app/app/layout.tsx'), 'utf8')
const hosting = JSON.parse(readFileSync(resolve(process.cwd(), 'firebase.json'), 'utf8'))
  .hosting[0] as { headers: { source: string; headers: { key: string; value: string }[] }[] }

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
    expect(generator).toContain("from '@next/env'")
    expect(generator).toContain('loadEnvConfig(')
    expect(generator).not.toContain('dotenv')
  })

  it('only opens same-origin links and reuses an open window', () => {
    expect(source).toContain('safeNotificationUrl(')
    expect(source).toContain('chooseWindowClient(')
    expect(source).toContain('.focus()')
  })
})

describe('App-shell service worker', () => {
  it('carries no Firebase code, so a guest never downloads it', () => {
    expect(shell).not.toMatch(/from '[^']*firebase|importScripts/)
  })

  it('takes over at once and deletes older versions on activate', () => {
    expect(shell).toContain('skipWaiting()')
    expect(shell).toContain('clients.claim()')
    expect(shell).toContain('staleCaches(')
  })

  it('is registered from the app without the HTTP cache, after the page loads', () => {
    expect(register).toContain("register('/sw.js',{updateViaCache:'none'})")
    expect(register).toContain("addEventListener('load'")
  })

  it('is never long-cached by Hosting, nor is the push worker', () => {
    // The last matching rule wins; this one comes after every broader rule.
    const last = hosting.headers.at(-1)
    expect(last?.source).toBe('/@(sw|firebase-messaging-sw).js')
    expect(last?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-cache' })
  })
})
