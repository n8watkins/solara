import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Account Data Controls | Solara',
  description: 'Download account data, manage billing, or request account deletion.',
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
