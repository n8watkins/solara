import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Shared Activity Window | Solara',
  description: 'A forecast-based lower-UV activity plan shared from Solara.',
  // Share pages show sender-written text, so they are kept out of search results.
  robots: { index: false, follow: false },
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children
}
