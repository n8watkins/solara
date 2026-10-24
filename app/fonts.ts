import localFont from 'next/font/local'

// Variable Inter (one file, every weight from 100 to 900), bundled from npm and
// served from this origin: no request to Google at runtime, preloaded, and with a
// metric-matched fallback so the swap does not shift layout. The Fontsource file
// is used instead of next/font/google because the file next/font downloads
// renders with uneven letter spacing in Chromium on Linux.
export const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
})
