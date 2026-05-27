import type { Metadata } from 'next'
import './globals.css'
import ThemeInit from '@/components/ThemeInit'

export const metadata: Metadata = {
  title: 'Solara — Know when to go outside',
  description: 'Personalized UV and sun exposure dashboard. Know exactly when it\'s safe to go outside for your activity and skin type.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  )
}
