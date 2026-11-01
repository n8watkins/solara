import { describe, expect, it } from 'vitest'
import {
  HEAD_FIRST_PAGES,
  STATIC_PAGES,
  pageLanguage,
  stripFrameworkScripts,
  withDocumentLanguage,
} from './static-pages.mts'
import { LANDING_REDIRECT_SCRIPT } from './landing-redirect'

const page = (body: string) => `<!DOCTYPE html><html><head>
<link rel="preload" href="/_next/static/media/inter.woff2" as="font" type="font/woff2"/>
<link rel="stylesheet" href="/_next/static/chunks/app.css"/>
<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/a.js"/>
<script src="/_next/static/chunks/a.js" async=""></script>
<script data-static="">(function(){document.documentElement.className='x'})()</script>
</head><body>${body}
<script id="_R_">(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":["/_next/static/chunks/b.js"]})</script>
<script>(self.__next_f=self.__next_f||[]).push([0])</script>
<script>self.__next_f.push([1,"payload"])</script>
</body></html>`

describe('stripFrameworkScripts', () => {
  it('keeps only our marked inline scripts, the styles and the font', () => {
    const { html, removed } = stripFrameworkScripts(
      page(`<script data-static="">${LANDING_REDIRECT_SCRIPT}</script><main>Hi</main>`),
    )
    expect(removed).toBe(5)
    expect(html).not.toMatch(/\.js/)
    expect(html).not.toContain('__next_f')
    expect(html).toContain(LANDING_REDIRECT_SCRIPT)
    expect(html).toContain("className='x'")
    expect(html).toContain('app.css')
    expect(html).toContain('inter.woff2')
    expect(html).toContain('<main>Hi</main>')
  })

  it('finds script tags the way browsers do, as the CSP step does', () => {
    const { html } = stripFrameworkScripts(
      page(
        '<script data-src="x">self.__next_f.push([2])</script >' +
          '<SCRIPT SRC="/_next/static/chunks/c.js"></SCRIPT\n foo>',
      ),
    )
    expect(html).not.toContain('__next_f')
    expect(html).not.toMatch(/\.js/)
  })

  it('moves a script marked data-head-first to the start of head, after the charset (REVIEW7 M1)', () => {
    const handOver = '(function(){postTheCode()})()'
    const { html, hoisted } = stripFrameworkScripts(
      page(`<main><script data-static="" data-head-first="">${handOver}</script>Hi</main>`).replace(
        '<head>',
        '<head><meta charSet="utf-8"/>',
      ),
    )
    expect(hoisted).toBe(1)
    expect(html).toContain(
      `<head><meta charSet="utf-8"/><script data-static="" data-head-first="">${handOver}</script>`,
    )
    // Before every stylesheet and font, and gone from the body.
    expect(html.indexOf(handOver)).toBeLessThan(html.indexOf('app.css'))
    expect(html.indexOf(handOver)).toBeLessThan(html.indexOf('inter.woff2'))
    expect(html.split(handOver)).toHaveLength(2)
    expect(html).toContain('<main>Hi</main>')
    // The other kept script stays where it was.
    expect(stripFrameworkScripts(page('')).hoisted).toBe(0)
    expect(HEAD_FIRST_PAGES).toEqual(['auth/microsoft/index.html'])
  })

  it('refuses an inline script it does not recognize', () => {
    expect(() => stripFrameworkScripts(page('<script>alert(1)</script>'))).toThrow(
      /unrecognized inline scripts/,
    )
  })

  it('refuses a page with nothing to strip (the Next.js output changed)', () => {
    expect(() => stripFrameworkScripts('<html><head></head><body></body></html>')).toThrow(
      /no framework scripts/,
    )
  })

  it('refuses a page that would still load framework JavaScript', () => {
    expect(() =>
      stripFrameworkScripts(page('<a href="/_next/static/chunks/c.js">chunk</a>')),
    ).toThrow(/still references framework JavaScript/)
  })
})

describe('the pages in Spanish (ROADMAP item 46)', () => {
  it('serves the Spanish landing and city pages without the framework too', () => {
    for (const page of ['index.html', 'uv/index.html', 'uv/tokyo/index.html']) {
      expect(STATIC_PAGES).toContain(page)
      expect(STATIC_PAGES).toContain(`es/${page}`)
    }
  })

  it('gives every page under es/ <html lang="es"> and leaves the rest English', () => {
    const html = '<!DOCTYPE html><html lang="en" class="x"><head></head><body></body></html>'
    expect(pageLanguage('es/privacy/index.html')).toBe('es')
    expect(pageLanguage('es\\uv\\tokyo\\index.html')).toBe('es')
    expect(pageLanguage('privacy/index.html')).toBe('en')
    expect(pageLanguage('estimate/index.html')).toBe('en')
    expect(withDocumentLanguage(html, 'es')).toBe(html.replace('lang="en"', 'lang="es"'))
    expect(withDocumentLanguage(html, 'en')).toBe(html)
    expect(() => withDocumentLanguage('<html><body></body></html>', 'es')).toThrow(/lang/)
  })
})
