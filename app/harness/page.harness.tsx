'use client'
// UI harness route (/harness/). The `.harness.tsx` extension is the exclusion
// mechanism: next.config.ts only adds it to `pageExtensions` when
// NEXT_PUBLIC_UI_HARNESS=1, so ordinary builds never see this file as a page and
// never compile the harness. scripts/check-no-ui-harness.mjs asserts that after
// every `npm run build`.
import dynamic from 'next/dynamic'

// Client-only, like app/page.tsx: the harness reads the (frozen) clock at render
// time, so a build-time prerender would not match the browser.
const HarnessApp = dynamic(() => import('@/tests/harness/HarnessApp'), { ssr: false })

export default function HarnessPage() {
  return <HarnessApp />
}
