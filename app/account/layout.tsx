import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Account Data Controls | Solara',
  description: 'Download account data, manage billing, or request account deletion.',
  // A signed-in person's data controls: kept out of search results and the sitemap.
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
