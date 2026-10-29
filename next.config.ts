import type { NextConfig } from 'next'

// UI harness builds (npm run test:harness) opt in to the `.harness.tsx` page
// extension, which is the only way app/harness/page.harness.tsx becomes a route,
// and export to their own directory so a harness build can never land in `out/`.
const uiHarness = process.env.NEXT_PUBLIC_UI_HARNESS === '1'

// Browser source maps exist only for the deploy workflow's Sentry upload, which
// deletes them before the artifact is packaged (.github/workflows/deploy.yml);
// .github/scripts/check-public-env.mjs fails a deploy that would publish one.
const browserSourceMaps = process.env.BROWSER_SOURCE_MAPS === '1'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Automatic memoization (babel-plugin-react-compiler). Components that break the
  // Rules of React are reported by the react-hooks lint rules and skipped by the
  // compiler instead of being miscompiled.
  reactCompiler: true,
  // @solara/core is a workspace package published as TypeScript source.
  transpilePackages: ['@solara/core'],
  productionBrowserSourceMaps: browserSourceMaps,
  // Always compiled in (as '' outside a harness build), so harness-only branches in
  // app code (lib/plans.ts alertsLaunched) are removed from production bundles.
  env: {
    NEXT_PUBLIC_UI_HARNESS: uiHarness ? '1' : '',
    // The build's version on Function calls (X-Solara-Client, lib/functions-api.ts): the
    // commit GitHub Actions builds, or 'dev' locally.
    NEXT_PUBLIC_CLIENT_VERSION: (process.env.GITHUB_SHA ?? '').slice(0, 12) || 'dev',
  },
  compiler: {
    // Strip the Sentry SDK's debug logging and tracing code (lib/sentry-options.ts
    // turns tracing off), as Sentry's bundle size options do.
    define: { __SENTRY_DEBUG__: false, __SENTRY_TRACING__: false },
  },
  ...(uiHarness && {
    pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'harness.tsx'],
    distDir: 'test-results/ui-harness/site',
  }),
}

export default nextConfig
