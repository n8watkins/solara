import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HEADER_POLICY,
  httpsOrigin,
  injectCspMeta,
  inlineEventHandlers,
  inlineScriptHashes,
  isSiteVerificationFile,
  pagePolicy,
  scriptHash,
  serializePolicy,
} from './csp.mjs'

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(';')
    .map(part => part.trim().split(/\s+/))
    .find(([key]) => key === name)
  return found ? found.slice(1) : []
}

const ENV = {
  authDomain: 'uv-activity-planner.firebaseapp.com',
  functionsUrl: 'https://us-central1-uv-activity-planner.cloudfunctions.net/',
}

describe('page policy', () => {
  const policy = serializePolicy(pagePolicy(["'sha256-abc='"], ENV))

  it('allows scripts only from self, page hashes and named hosts', () => {
    const scripts = directive(policy, 'script-src')
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
    expect(scripts).toContain("'sha256-abc='")
    expect(scripts.filter(s => s.includes('*'))).toEqual([])
    expect(directive(policy, 'script-src-attr')).toEqual(["'none'"])
    expect(directive(policy, 'default-src')).toEqual(["'self'"])
  })

  it('allows the script origins Firebase Google sign-in and GA need', () => {
    const scripts = directive(policy, 'script-src')
    expect(scripts).toContain('https://apis.google.com')
    expect(scripts).toContain('https://www.googletagmanager.com')
  })

  it('names exact hosts for connections, with wildcards only for GA4', () => {
    const connect = directive(policy, 'connect-src')
    expect(connect).toContain('https://us-central1-uv-activity-planner.cloudfunctions.net')
    expect(connect).toContain('https://firestore.googleapis.com')
    expect(connect).not.toContain('https://*.googleapis.com')
    expect(connect).not.toContain('https://*.cloudfunctions.net')
    for (const source of connect.filter(s => s.includes('*'))) {
      expect(source).toMatch(
        /^https:\/\/\*\.(google-analytics\.com|analytics\.google\.com|googletagmanager\.com)$/,
      )
    }
  })

  it('loads no web fonts from third parties and frames only sign-in and reCAPTCHA', () => {
    expect(directive(policy, 'font-src')).toEqual(["'self'"])
    expect(policy).not.toContain('fonts.googleapis.com')
    expect(policy).not.toContain('fonts.gstatic.com')
    expect(directive(policy, 'frame-src')).toEqual([
      'https://uv-activity-planner.firebaseapp.com',
      'https://accounts.google.com/gsi/',
      'https://www.google.com/recaptcha/',
      'https://recaptcha.google.com/recaptcha/',
    ])
  })

  it('allows exactly the image Firestore loads to test connectivity, nothing else on google.com', () => {
    const images = directive(policy, 'img-src')
    expect(images).toContain('https://www.google.com/images/cleardot.gif')
    expect(images.filter(s => s.includes('www.google.com'))).toEqual([
      'https://www.google.com/images/cleardot.gif',
    ])
  })

  it('omits optional origins that are not configured or not https', () => {
    const bare = serializePolicy(pagePolicy([], { functionsUrl: 'http://insecure.test' }))
    expect(bare).not.toContain('insecure.test')
    expect(directive(bare, 'frame-src')[0]).toBe('https://accounts.google.com/gsi/')
    expect(httpsOrigin('')).toBeNull()
    expect(httpsOrigin('example.firebaseapp.com')).toBe('https://example.firebaseapp.com')
  })
})

describe('inline script hashing', () => {
  it('hashes the exact text of inline scripts and skips external ones', () => {
    const html =
      '<head><script src="/a.js"></script><script>self.x=1</script></head>' +
      '<body><script id="b">self.x=1</script><script>\nself.y=2\n</script></body>'
    expect(inlineScriptHashes(html)).toEqual([scriptHash('self.x=1'), scriptHash('\nself.y=2\n')])
    // Known vector: sha256("alert(1)") in base64.
    expect(scriptHash('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='")
  })

  it('finds inline event handlers, which the policy would block', () => {
    expect(inlineEventHandlers('<img src="x" onerror="go()"><a href="#">ok</a>')).toEqual([
      'onerror',
    ])
    expect(inlineEventHandlers('<p>one only</p>')).toEqual([])
  })
})

describe('injectCspMeta', () => {
  it('places the policy first in head and replaces an existing one', () => {
    const html = '<html><head><meta charset="utf-8"/><script>1</script></head></html>'
    const once = injectCspMeta(html, "script-src 'self'")
    expect(once).toBe(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"/>' +
        '<meta charset="utf-8"/><script>1</script></head></html>',
    )
    const twice = injectCspMeta(once, "script-src 'none'")
    expect(twice.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(twice).toContain('content="script-src \'none\'"')
  })

  it('refuses a document without a head', () => {
    expect(() => injectCspMeta('<p>no head</p>', "default-src 'self'")).toThrow('<head>')
  })
})

describe('header policy', () => {
  it('carries frame-ancestors, which a meta policy cannot', () => {
    expect(serializePolicy(HEADER_POLICY)).toContain("frame-ancestors 'none'")
  })
})

interface HostingRule {
  source: string
  headers: Array<{ key: string; value: string }>
}
interface HostingSite {
  site: string
  headers: HostingRule[]
  rewrites?: unknown[]
  redirects?: Array<{ source?: string; regex?: string; destination: string; type: number }>
  trailingSlash?: boolean
}
const sites = (
  JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')) as {
    hosting: HostingSite[]
  }
).hosting
const hosting = sites.find(site => site.site === 'solara-uv')!

describe('isSiteVerificationFile', () => {
  it('matches only exact Google Search Console ownership files', () => {
    const name = 'google21ab865e0385ac48.html'
    expect(isSiteVerificationFile(name, `google-site-verification: ${name}\n`)).toBe(true)
    expect(isSiteVerificationFile(name, '<html><head></head></html>')).toBe(false)
    expect(
      isSiteVerificationFile('google21ab.html', 'google-site-verification: google21ab.html'),
    ).toBe(false)
    expect(isSiteVerificationFile('index.html', 'google-site-verification: index.html')).toBe(false)
  })
})

describe('firebase.json hosting', () => {
  const global = hosting.headers.find(rule => rule.source === '**')?.headers ?? []
  const header = (key: string) => global.find(h => h.key === key)?.value

  it('sends the header policy from lib/csp.mts, with no unsafe-inline anywhere', () => {
    expect(header('Content-Security-Policy')).toBe(serializePolicy(HEADER_POLICY))
    expect(JSON.stringify(hosting)).not.toContain('unsafe-inline')
  })

  it('serves unknown paths as 404 instead of rewriting them to the app', () => {
    expect(hosting.rewrites ?? []).toEqual([])
    expect(hosting.trailingSlash).toBe(true)
  })

  it('revalidates HTML, caches hashed assets for a year and never uses no-store', () => {
    expect(header('Cache-Control')).toBe('no-cache')
    const statics = hosting.headers.find(rule => rule.source === '/_next/static/**')
    expect(statics?.headers).toEqual([
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ])
    expect(JSON.stringify(hosting)).not.toContain('no-store')
  })

  it('permanently redirects the old address to the same path on the app site', () => {
    const old = sites.find(site => site.site === 'uv-activity-planner')
    expect(old?.redirects?.[0]).toEqual({
      source: '/',
      destination: 'https://solara-uv.web.app/',
      type: 301,
    })
    const rule = old?.redirects?.[1] as { regex: string; destination: string } | undefined
    expect(rule?.destination).toBe('https://solara-uv.web.app/:path')
    // Hosting evaluates RE2 `(?P<name>)` groups; JavaScript spells them `(?<name>)`.
    const pattern = new RegExp(rule!.regex.replace('(?P<', '(?<'))
    const target = (path: string) => pattern.exec(path)?.groups?.path
    expect(target('/privacy/')).toBe('privacy/')
    expect(target('/share/x')).toBe('share/x')
    expect(target('/_next/static/a.js')).toBe('_next/static/a.js')
    expect(target('/_')).toBe('_')
    // Firebase's reserved paths (sign-in helpers, SDK config) stay on the old origin.
    expect(pattern.test('/__/firebase/init.json')).toBe(false)
    expect(pattern.test('/__/auth/handler')).toBe(false)
  })

  it('keeps share pages out of search engines', () => {
    const share = hosting.headers.find(rule => rule.source.startsWith('/share'))
    expect(share?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' })
  })
})
