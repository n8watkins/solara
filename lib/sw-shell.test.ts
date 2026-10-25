import { describe, expect, it } from 'vitest'
import {
  NAVIGATION_TIMEOUT_MS,
  cacheNames,
  manifestIcons,
  missingPageAssets,
  pageAssets,
  routeRequest,
  shellPageFor,
  staleCaches,
  stylesheetAssets,
} from './sw-shell.mts'

const ORIGIN = 'https://solara-uv.web.app'
const precached = new Set(['/', '/app/', '/manifest.webmanifest', '/icon-192.png'])
const get = (path: string, mode = 'cors', origin = ORIGIN) => ({
  url: origin + path,
  method: 'GET',
  mode,
})

describe('pageAssets', () => {
  const html = `<!DOCTYPE html><html><head>
    <link rel="stylesheet" href="/_next/static/chunks/a1.css"/>
    <link rel="preload" href="/_next/static/media/inter.woff2" as="font"/>
    <link rel="manifest" href="/manifest.webmanifest"/>
    <link rel="icon" href="/icon-192.png"/>
    <script src="/_next/static/chunks/main.js" async=""></script>
    </head><body>
    <a href="/privacy/">Privacy</a><a href="/app/?signin">Sign in</a><a href="/">Home</a>
    <a href="https://open-meteo.com/">Open-Meteo</a>
    <img src="/landing/light.webp" srcSet="/landing/dark.webp 1x, /landing/dark@2x.webp 2x"/>
    <img src="//cdn.example/x.png"/>
    <script>self.__next_f.push([1,"3:I[1,[\\"/_next/static/chunks/client.js\\"],\\"default\\"]"])</script>
    </body></html>`

  it('lists the files a page loads, including chunks named only in its RSC data', () => {
    expect(pageAssets(html)).toEqual([
      '/_next/static/chunks/a1.css',
      '/_next/static/chunks/client.js',
      '/_next/static/chunks/main.js',
      '/_next/static/media/inter.woff2',
      '/icon-192.png',
      '/landing/dark.webp',
      '/landing/dark@2x.webp',
      '/landing/light.webp',
      '/manifest.webmanifest',
    ])
  })

  it('leaves out links to pages, query strings and other origins', () => {
    const assets = pageAssets(html)
    expect(assets).not.toContain('/privacy/')
    expect(assets).not.toContain('/')
    expect(assets.some(url => url.includes('?') || url.startsWith('//'))).toBe(false)
  })
})

describe('stylesheetAssets', () => {
  it('resolves fonts against the stylesheet and skips data and other origins', () => {
    const css =
      '@font-face{src:url(../media/inter.woff2) format("woff2")}' +
      '.a{background:url("data:image/png;base64,AAAA")}' +
      ".b{background:url('https://example.com/x.png')}" +
      '.c{mask:url(#m)}'
    expect(stylesheetAssets(css, '/_next/static/chunks/a1.css')).toEqual([
      '/_next/static/media/inter.woff2',
    ])
  })
})

describe('manifestIcons', () => {
  it('lists root-relative icon files only', () => {
    expect(
      manifestIcons({
        icons: [{ src: '/icon-512.png' }, { src: '/icon-192.png' }, { src: 'https://x/y.png' }, {}],
      }),
    ).toEqual(['/icon-192.png', '/icon-512.png'])
    expect(manifestIcons(null)).toEqual([])
    expect(manifestIcons({ icons: 'no' })).toEqual([])
  })
})

describe('routeRequest', () => {
  it('answers navigations to the shell pages only', () => {
    expect(routeRequest(get('/app/', 'navigate'), ORIGIN, precached)).toEqual({
      kind: 'page',
      page: '/app/',
    })
    expect(routeRequest(get('/app/?signin', 'navigate'), ORIGIN, precached)).toEqual({
      kind: 'page',
      page: '/app/',
    })
    expect(routeRequest(get('/', 'navigate'), ORIGIN, precached)).toEqual({
      kind: 'page',
      page: '/',
    })
    for (const path of ['/privacy/', '/share/?d=1', '/account/', '/apps/'])
      expect(routeRequest(get(path, 'navigate'), ORIGIN, precached), path).toBeNull()
  })

  it('answers hashed files and precached files', () => {
    expect(routeRequest(get('/_next/static/chunks/x.js'), ORIGIN, precached)).toEqual({
      kind: 'static',
    })
    expect(routeRequest(get('/icon-192.png', 'no-cors'), ORIGIN, precached)).toEqual({
      kind: 'precached',
    })
    expect(routeRequest(get('/icon-192.png?v=2'), ORIGIN, precached)).toBeNull()
    expect(routeRequest(get('/og-image.png'), ORIGIN, precached)).toBeNull()
  })

  it('never touches other origins, Firebase paths or anything but GET', () => {
    for (const url of [
      'https://api.open-meteo.com/v1/forecast?latitude=1',
      'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen',
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
      'https://us-central1-uv-activity-planner.cloudfunctions.net/api',
    ])
      expect(routeRequest({ url, method: 'GET', mode: 'cors' }, ORIGIN, precached), url).toBeNull()
    expect(routeRequest(get('/__/auth/handler', 'navigate'), ORIGIN, precached)).toBeNull()
    expect(routeRequest(get('/__/firebase/init.json'), ORIGIN, precached)).toBeNull()
    expect(
      routeRequest({ ...get('/_next/static/chunks/x.js'), method: 'POST' }, ORIGIN, precached),
    ).toBeNull()
  })
})

describe('shellPageFor', () => {
  it('maps the spellings Hosting serves to the cached page', () => {
    expect(shellPageFor('/index.html')).toBe('/')
    expect(shellPageFor('/app')).toBe('/app/')
    expect(shellPageFor('/app/index.html')).toBe('/app/')
    expect(shellPageFor('/app/x')).toBeNull()
  })
})

describe('versions', () => {
  it('names one shell and one static cache per version', () => {
    expect(cacheNames('abc')).toEqual({ shell: 'solara-shell-abc', static: 'solara-static-abc' })
  })

  it("deletes other versions' caches and nothing else", () => {
    expect(
      staleCaches(
        [
          'solara-shell-old',
          'solara-static-old',
          'solara-shell-new',
          'solara-static-new',
          'solara-notification-deliveries-v1',
          'some-other-cache',
        ],
        'new',
      ),
    ).toEqual(['solara-shell-old', 'solara-static-old'])
  })

  it('refuses a page from another deploy', () => {
    const page = '<script src="/_next/static/chunks/new.js"></script>'
    expect(missingPageAssets(page, new Set(['/_next/static/chunks/old.js']))).toEqual([
      '/_next/static/chunks/new.js',
    ])
    expect(missingPageAssets(page, new Set(['/_next/static/chunks/new.js']))).toEqual([])
  })

  it('falls back to the cached page after a few seconds without an answer', () => {
    expect(NAVIGATION_TIMEOUT_MS).toBeGreaterThanOrEqual(3000)
    expect(NAVIGATION_TIMEOUT_MS).toBeLessThanOrEqual(5000)
  })
})
