import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cspEnvFrom,
  HEADER_POLICY,
  httpsOrigin,
  injectCspMeta,
  inlineEventHandlers,
  inlineScriptHashes,
  isSiteVerificationFile,
  pagePolicy,
  scriptHash,
  sentryIngestOrigin,
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
    const host = (source: string) => (URL.canParse(source) ? new URL(source).hostname : null)
    expect(images.filter(s => host(s) === 'www.google.com')).toEqual([
      'https://www.google.com/images/cleardot.gif',
    ])
  })

  it('frames its own origin only in an emulator build, and changes nothing else', () => {
    const emulator = pagePolicy(["'sha256-abc='"], { ...ENV, emulators: true })
    const production = pagePolicy(["'sha256-abc='"], ENV)
    expect(emulator['frame-src']).toEqual(["'self'", ...(production['frame-src'] ?? [])])
    expect({ ...emulator, 'frame-src': production['frame-src'] }).toEqual(production)
    expect(directive(policy, 'frame-src')).not.toContain("'self'")
  })

  it('reads the emulator option only from the exact emulator flag', () => {
    const build = {
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: ENV.authDomain,
      NEXT_PUBLIC_FUNCTIONS_URL: ENV.functionsUrl,
    }
    // A production build (no flag, or any other value) gets the same policy as before.
    for (const flag of [undefined, '', '0', 'true']) {
      const env = cspEnvFrom({ ...build, NEXT_PUBLIC_FIREBASE_EMULATORS: flag })
      expect(env.emulators).toBe(false)
      expect(pagePolicy([], env)).toEqual(pagePolicy([], ENV))
    }
    expect(cspEnvFrom({ ...build, NEXT_PUBLIC_FIREBASE_EMULATORS: '1' })).toEqual({
      ...ENV,
      emulators: true,
    })
  })

  it('omits optional origins that are not configured or not https', () => {
    const bare = serializePolicy(pagePolicy([], { functionsUrl: 'http://insecure.test' }))
    expect(bare).not.toContain('insecure.test')
    expect(directive(bare, 'frame-src')[0]).toBe('https://accounts.google.com/gsi/')
    expect(httpsOrigin('')).toBeNull()
    expect(httpsOrigin('example.firebaseapp.com')).toBe('https://example.firebaseapp.com')
  })
})

describe('App Check reCAPTCHA v3', () => {
  const policy = serializePolicy(pagePolicy([], ENV))
  const recaptcha = (name: string) => directive(policy, name).filter(s => s.includes('recaptcha'))

  it('allows exactly the sources reCAPTCHA v3 uses, on no other directive', () => {
    expect(recaptcha('script-src')).toEqual([
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
    ])
    expect(recaptcha('frame-src')).toEqual([
      'https://www.google.com/recaptcha/',
      'https://recaptcha.google.com/recaptcha/',
    ])
    expect(recaptcha('connect-src')).toEqual(['https://www.google.com/recaptcha/'])
    for (const name of ['img-src', 'style-src', 'font-src', 'worker-src']) {
      expect(recaptcha(name)).toEqual([])
    }
    // Paths, never whole hosts: www.google.com and www.gstatic.com serve much more.
    expect(policy).not.toMatch(/https:\/\/www\.(google|gstatic)\.com(?=[ ;]|$)/)
  })

  it('lets App Check exchange its token', () => {
    expect(directive(policy, 'connect-src')).toContain(
      'https://content-firebaseappcheck.googleapis.com',
    )
  })
})

describe('Sentry error reporting', () => {
  const DSN = 'https://abc123public@o11.ingest.us.sentry.io/22'

  it('allows no Sentry host unless the build has a DSN', () => {
    const policy = serializePolicy(pagePolicy([], ENV))
    expect(policy).not.toContain('sentry')
    expect(cspEnvFrom({}).sentryDsn).toBeUndefined()
  })

  it("connects to exactly the DSN's ingest host, and nowhere else on sentry.io", () => {
    const env = cspEnvFrom({ NEXT_PUBLIC_SENTRY_DSN: DSN })
    const policy = serializePolicy(pagePolicy([], { ...ENV, ...env }))
    expect(directive(policy, 'connect-src')).toContain('https://o11.ingest.us.sentry.io')
    // Only connect-src: the SDK is bundled, so no script, frame or image source changes.
    expect(policy.match(/sentry/g)).toHaveLength(1)
  })

  it('ignores values that are not Sentry public DSNs', () => {
    for (const value of [
      undefined,
      '',
      'not a url',
      'http://abc@o1.ingest.sentry.io/2',
      'https://o1.ingest.sentry.io/2',
      'https://abc:secret@o1.ingest.sentry.io/2',
      'https://abc@o1.ingest.sentry.io/not-a-project',
    ]) {
      expect(sentryIngestOrigin(value)).toBeNull()
      expect(serializePolicy(pagePolicy([], { sentryDsn: value }))).not.toContain('sentry')
    }
    expect(sentryIngestOrigin(` ${DSN} `)).toBe('https://o11.ingest.us.sentry.io')
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

  it('ends a script where browsers do, in any case and with any end-tag whitespace', () => {
    const html =
      '<SCRIPT>self.a=1</SCRIPT>' +
      '<script>self.b=2</script >' +
      '<Script type="module">self.c=3</sCrIpT\t\n bar>' +
      '<script>self.d="</scriptx>"</script/>'
    expect(inlineScriptHashes(html)).toEqual([
      scriptHash('self.a=1'),
      scriptHash('self.b=2'),
      scriptHash('self.c=3'),
      scriptHash('self.d="</scriptx>"'),
    ])
  })

  it('reads attributes as browsers do', () => {
    const html =
      '<script data-note="a > b">self.a=1</script>' +
      "<script data-src='/x.js'>self.b=2</script>" +
      '<script\nSRC = "/c.js"></script>' +
      '<script async src=/d.js></script>' +
      '<script defer\tsrc></script>'
    expect(inlineScriptHashes(html)).toEqual([scriptHash('self.a=1'), scriptHash('self.b=2')])
  })

  it('ignores elements whose names only start with script', () => {
    const html = '<scripts>no</scripts><script-x>no</script-x><script>yes</script>'
    expect(inlineScriptHashes(html)).toEqual([scriptHash('yes')])
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
