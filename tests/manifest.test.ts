// The web app manifest (public/manifest.webmanifest), which installs Solara and will
// describe it to a Trusted Web Activity (docs/integrations/ANDROID.md).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Icon {
  src: string
  sizes: string
  type: string
}
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  id: string
  start_url: string
  scope: string
  icons: Icon[]
  shortcuts: Array<{ name: string; short_name: string; url: string; icons: Icon[] }>
}

/** The app/ page that serves a root-relative URL path in the static export. */
function pageFor(url: string): string {
  const path = new URL(url, 'https://solara-uv.web.app').pathname.replace(/^\/|\/$/g, '')
  return path ? `app/${path}/page.tsx` : 'app/page.tsx'
}

describe('the web app manifest', () => {
  it('keeps the installed identity: its id is the start URL browsers used before', () => {
    // Without an id, browsers identify an installed app by its start_url. Setting the same
    // value keeps every existing install the same app (and a TWA's package tied to it).
    expect(manifest.id).toBe('/app/')
    expect(manifest.start_url).toBe('/app/')
  })

  it('offers shortcuts to pages the export has, inside its scope', () => {
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2)
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.url.startsWith(manifest.scope)).toBe(true)
      expect(existsSync(pageFor(shortcut.url)), shortcut.url).toBe(true)
      expect(shortcut.short_name.length).toBeLessThanOrEqual(12)
      for (const icon of shortcut.icons) expect(existsSync(`public${icon.src}`)).toBe(true)
    }
  })

  it('names icons that exist', () => {
    for (const icon of manifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true)
  })
})
