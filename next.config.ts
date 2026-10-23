import type { NextConfig } from 'next'

// UI harness builds (npm run test:harness) opt in to the `.harness.tsx` page
// extension, which is the only way app/harness/page.harness.tsx becomes a route,
// and export to their own directory so a harness build can never land in `out/`.
const uiHarness = process.env.NEXT_PUBLIC_UI_HARNESS === '1'

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
  ...(uiHarness && {
    pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'harness.tsx'],
    distDir: 'test-results/ui-harness/site',
  }),
}

export default nextConfig
