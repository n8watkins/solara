import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Shared Activity Window | Solara',
  description: 'A forecast-based lower-UV activity plan shared from Solara.',
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children
}
