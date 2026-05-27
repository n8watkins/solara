import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Solara — Know your sun window',
  description: 'Personalized UV and sun exposure dashboard. Know exactly when to go outside for your activity, skin type, and sunscreen preference.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
