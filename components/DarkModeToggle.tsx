'use client'
import { useState, useEffect } from 'react'
import { getStoredTheme, toggleTheme } from '@/lib/theme'

export default function DarkModeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-only state is read after hydration so the static export's prerendered markup matches the first client render.
    setDark(getStoredTheme() === 'dark')
  }, [])

  function handleToggle() {
    const next = toggleTheme()
    setDark(next === 'dark')
  }

  return (
    <button
      onClick={handleToggle}
      className="btn btn-ghost"
      style={{ padding: '6px 10px', fontSize: '16px' }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  )
}
