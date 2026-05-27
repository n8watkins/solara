const KEY = 'solara_theme'

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return (localStorage.getItem(KEY) as 'light' | 'dark') || 'light'
}

export function applyTheme(theme: 'light' | 'dark') {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem(KEY, theme)
}

export function toggleTheme(): 'light' | 'dark' {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const next = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
