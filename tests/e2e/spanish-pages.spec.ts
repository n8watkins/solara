import { expect, test, type Page } from '@playwright/test'

// The static pages in Spanish (ROADMAP item 46, decision "Language pages") on the export
// that ships: each English page has a Spanish address under /es/, written in Spanish with
// <html lang="es">, canonical to itself, with hreflang links both ways and English as
// x-default, a visible link to the other language, and the same lack of framework
// JavaScript as its English page. The legal pages say the English version prevails.

const PAIRS = [
  { en: '/', es: '/es/', title: 'Solara: planifica según el UV', heading: 'Sabe cuándo salir' },
  {
    en: '/privacy/',
    es: '/es/privacy/',
    title: 'Política de privacidad | Solara',
    heading: 'Política de privacidad',
  },
  {
    en: '/terms/',
    es: '/es/terms/',
    title: 'Términos de uso | Solara',
    heading: 'Términos de uso',
  },
  { en: '/uv/', es: '/es/uv/', title: /^Índice UV por ciudad/, heading: 'UV por ciudad' },
  {
    en: '/uv/mexico-city/',
    es: '/es/uv/mexico-city/',
    title: 'Índice UV en Ciudad de México por mes | Solara',
    heading: 'Índice UV en Ciudad de México',
  },
] as const

/** The page's canonical address and its hreflang alternates, as paths. */
async function alternates(page: Page) {
  const head = page.locator('head')
  const path = (href: string | null) => (href ? new URL(href).pathname : null)
  const links = head.locator('link[rel="alternate"][hreflang]')
  const languages: Record<string, string | null> = {}
  for (const link of await links.all()) {
    languages[(await link.getAttribute('hreflang'))!] = path(await link.getAttribute('href'))
  }
  return {
    canonical: path(await head.locator('link[rel="canonical"]').getAttribute('href')),
    languages,
  }
}

for (const pair of PAIRS) {
  test(`${pair.es} is the Spanish ${pair.en}, linked both ways`, async ({ page }) => {
    const scripts: string[] = []
    page.on('request', request => {
      if (request.resourceType() === 'script') scripts.push(request.url())
    })
    await page.goto(pair.es)
    await expect(page.getByRole('heading', { level: 1, name: pair.heading })).toBeVisible()
    await page.waitForLoadState('networkidle')
    // Still Spanish once the page has loaded (the legal pages hydrate).
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page).toHaveTitle(pair.title)
    const languages = { en: pair.en, es: pair.es, 'x-default': pair.en }
    expect(await alternates(page)).toEqual({ canonical: pair.es, languages })

    // The footer's legal links are the Spanish pages.
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('link', { name: 'Privacidad' })).toHaveAttribute(
      'href',
      '/es/privacy/',
    )
    await expect(footer.getByRole('link', { name: 'Términos' })).toHaveAttribute(
      'href',
      '/es/terms/',
    )

    const english = page.getByRole('link', { name: 'Read this page in English' })
    await expect(english).toHaveAttribute('href', pair.en)
    await expect(english).toHaveAttribute('hreflang', 'en')
    await expect(english).toHaveText('English')
    // The legal pages hydrate, as in English; the rest ship no framework JavaScript.
    if (!pair.en.match(/privacy|terms/)) expect(scripts).toEqual([])

    await english.click()
    await expect(page).toHaveURL(url => url.pathname === pair.en)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await alternates(page)).toEqual({ canonical: pair.en, languages })
    const spanish = page.getByRole('link', { name: 'Leer esta página en español' })
    await expect(spanish).toHaveText('Español')
    await expect(spanish).toHaveAttribute('href', pair.es)
  })
}

test('the Spanish legal pages say the English version prevails', async ({ page }) => {
  for (const path of ['/es/privacy/', '/es/terms/']) {
    await page.goto(path)
    await expect(page.getByText(/Última actualización: \d+ de \w+ de 20\d\d/)).toBeVisible()
    await expect(page.getByText(/prevalece la versión en inglés/).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Idioma' })).toBeVisible()
    await expect(page.getByRole('link', { name: '← Volver a Solara' })).toHaveAttribute(
      'href',
      '/es/',
    )
  }
})

test('the Spanish landing page leads into the app and to the Spanish city pages', async ({
  page,
}) => {
  await page.goto('/es/')
  const main = page.getByRole('main')
  await expect(main.getByText('Alertas matutinas y de UV (muy pronto)')).toBeVisible()
  await expect(main.getByText(/\$19\.99 al año\. 7 días de prueba gratis/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ciudad de México' })).toHaveAttribute(
    'href',
    '/es/uv/mexico-city/',
  )
  await expect(page.getByRole('link', { name: /colaboradores de OpenStreetMap/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Solara en un teléfono/ })).toBeVisible()
  await expect(page.locator('img[src^="/landing/"]')).toHaveAttribute(
    'src',
    '/landing/dashboard-es-light.webp',
  )
  await expect(page.locator('img[src^="/landing/"]')).toHaveJSProperty('complete', true)
  expect(
    await page
      .locator('img[src^="/landing/"]')
      .evaluate(img => (img as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0)
  await main.getByRole('link', { name: 'Pruébalo ahora' }).first().click()
  await expect(page).toHaveURL(/\/app\/$/)
})

test('the sitemap lists every page in both languages, with its alternates', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text()
  for (const path of ['/', '/privacy/', '/terms/', '/uv/', '/uv/tokyo/']) {
    expect(sitemap).toContain(`${path}</loc>`)
    expect(sitemap).toContain(`/es${path}</loc>`)
    expect(sitemap).toMatch(new RegExp(`hreflang="es" href="[^"]+/es${path}"`))
  }
  expect(sitemap).toContain('hreflang="x-default"')
})
