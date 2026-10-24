import { describe, expect, it } from 'vitest'
import { stripFrameworkScripts } from './static-pages.mts'
import { LANDING_REDIRECT_SCRIPT } from './app-routes'

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
