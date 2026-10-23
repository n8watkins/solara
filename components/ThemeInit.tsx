'use client'
import { useEffect } from 'react'
import { subscribeToTheme, syncTheme } from '@/lib/theme'

// The blocking head script in app/layout.tsx applies the theme before first
// paint. This keeps it current afterwards: OS theme changes while the
// preference is "system", and preference changes made in another tab.
export default function ThemeInit() {
  useEffect(() => {
    syncTheme()
    return subscribeToTheme(() => {
      syncTheme()
    })
  }, [])
  return null
}
