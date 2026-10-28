import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

// The city pages (app/uv/) on the export that ships: static HTML with no framework
// JavaScript, their own title, description, canonical address and social cards, in
// the sitemap, linked from the landing page, and a link that opens setup on the city.

test('a city page is static, described and linked', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  await page.goto('/uv/los-angeles/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'UV index in Los Angeles' }),
  ).toBeVisible()
  await expect(page).toHaveTitle('UV index in Los Angeles by month | Solara')
  const head = page.locator('head')
  await expect(head.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /^Typical UV index in Los Angeles, California by month: UV peaks around 10\.3 in July\./,
  )
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/uv\/los-angeles\/$/,
  )
  await expect(head.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'UV index in Los Angeles by month | Solara',
  )
  await expect(head.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /og-image\.png$/,
  )
  await expect(page.getByRole('row')).toHaveCount(13)
  await expect(page.getByRole('link', { name: 'San Diego' })).toHaveAttribute(
    'href',
    '/uv/san-diego/',
  )
  // No framework JavaScript: the page loads no script at all.
  await page.waitForLoadState('networkidle')
  expect(scripts).toEqual([])
})

test('the index, the sitemap and the landing page link every city', async ({ page, request }) => {
  await page.goto('/uv/')
  await expect(page.getByRole('heading', { level: 1, name: 'UV by city' })).toBeVisible()
  const cityLinks = page.locator('main a[href^="/uv/"]')
  expect(await cityLinks.count()).toBeGreaterThanOrEqual(50)

  const sitemap = await (await request.get('/sitemap.xml')).text()
  expect(sitemap).toContain('/uv/</loc>')
  expect(sitemap).toContain('/uv/tokyo/</loc>')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Typical UV by city' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tokyo' })).toHaveAttribute('href', '/uv/tokyo/')
})

test("a city page's link opens setup on that city", async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ current: { uv_index: 6.4 } }),
    }),
  )
  await page.goto('/uv/tokyo/')
  await page.getByRole('link', { name: "See today's UV" }).click()
  await expect(page).toHaveURL(/\/app\/$/)
  // Setup skips the search: the UV preview for Tokyo shows straight away.
  await expect(page.getByText('UV index right now in')).toBeVisible()
  await expect(page.getByText('Tokyo', { exact: true })).toBeVisible()
  await expect(page.getByText('6.4', { exact: true })).toBeVisible()
})

test('an unknown city leaves setup on the search', async ({ page }) => {
  await page.goto('/app/?city=atlantis')
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await expect(page.getByLabel('City or location')).toBeEnabled()
  await expect(page).toHaveURL(/\/app\/$/)
})

test('a city page follows an OS theme change while open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/uv/los-angeles/')
  const root = page.locator('html')
  await expect(root).toHaveClass(/\bdark\b/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).not.toHaveClass(/\bdark\b/)
})

test('a city page carries structured data that its CSP allows', async ({ page }) => {
  const violations: string[] = []
  page.on('console', message => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  const response = await page.goto('/uv/los-angeles/')
  const html = (await response?.text()) ?? ''
  const body = /<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/.exec(html)?.[1]
  expect(body, 'the page has a JSON-LD script').toBeTruthy()
  const data = JSON.parse(body!) as { '@graph': { '@type': string; about?: { name: string } }[] }
  expect(data['@graph'].map(node => node['@type'])).toEqual(['WebPage', 'BreadcrumbList'])
  expect(data['@graph'][0]?.about?.name).toBe('Los Angeles, California')
  // The build hashed it into the page's policy (scripts/csp.mjs), nothing by hand.
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
  const hash = createHash('sha256').update(body!).digest('base64')
  expect(policy).toContain(`'sha256-${hash}'`)
  await page.waitForLoadState('networkidle')
  expect(violations).toEqual([])
})
