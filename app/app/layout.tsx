import type { ReactNode } from 'react'

// Registers the app-shell service worker (scripts/sw/shell.ts, built into /sw.js by
// scripts/build-sw.mjs) once the page has loaded, so it never competes with the first
// paint and adds nothing to the app's JavaScript. An inline script, hashed into the
// page's CSP by scripts/csp.mjs like every other. Production builds only: `next dev`
// has no shell to cache.
const REGISTER_SHELL_WORKER =
  "if('serviceWorker'in navigator)addEventListener('load',function(){" +
  "navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(function(){})})"

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {process.env.NODE_ENV === 'production' && (
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SHELL_WORKER }} />
      )}
    </>
  )
}
