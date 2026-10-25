import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

// The old address (uv-activity-planner.web.app) is a second Hosting site that only
// redirects to the app's address, keeping the path and query. Firebase's reserved
// `/__/` paths (Auth handlers, init.js) are left alone. Served through the Hosting
// emulator with the real firebase.json (tests/e2e/serve-export.mjs --redirect-site).
const redirectSite = `http://127.0.0.1:${process.env.PLAYWRIGHT_REDIRECT_PORT}`
const NEW_ORIGIN = 'https://solara-uv.web.app'

// Plain HTTP checks: one browser project is enough.
test.skip(({ isMobile }) => isMobile, 'plain HTTP checks; the desktop project covers them')

async function location(request: APIRequestContext, path: string) {
  const response = await request.get(`${redirectSite}${path}`, { maxRedirects: 0 })
  return { status: response.status(), location: response.headers().location }
}

test('the old address sends every page to the same path on the new one', async ({ request }) => {
  expect(await location(request, '/')).toEqual({ status: 301, location: `${NEW_ORIGIN}/` })
  for (const path of ['/app/', '/privacy/', '/share/', '/_next/static/x.js', '/a_b/', '/_']) {
    expect(await location(request, path), path).toEqual({
      status: 301,
      location: `${NEW_ORIGIN}${path}`,
    })
  }
})

test('the redirect keeps the query string', async ({ request }) => {
  expect(await location(request, '/share/?d=abc&u=1')).toEqual({
    status: 301,
    location: `${NEW_ORIGIN}/share/?d=abc&u=1`,
  })
})

test("Firebase's reserved /__/ paths are not redirected", async ({ request }) => {
  for (const path of ['/__/auth/handler', '/__/firebase/init.json']) {
    const { status } = await location(request, path)
    expect(status, path).not.toBe(301)
  }
})
