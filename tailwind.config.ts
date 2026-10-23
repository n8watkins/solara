import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Themes switch with the `dark` class on <html> (set by lib/theme.ts), not the
  // media query, so an explicit Light or Dark choice overrides the OS setting.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens from app/globals.css; they follow the active theme.
        surface: {
          DEFAULT: 'var(--bg)',
          card: 'var(--bg-card)',
          metric: 'var(--bg-metric)',
          subtle: 'var(--bg-subtle)',
        },
        ink: {
          DEFAULT: 'var(--text)',
          2: 'var(--text-2)',
          3: 'var(--text-3)',
        },
        brand: 'var(--brand)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          on: 'var(--on-accent)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        uv: {
          none: '#D1D5DB',
          low: '#86EFAC',
          moderate: '#FCD34D',
          high: '#FB923C',
          veryhigh: '#F87171',
          extreme: '#C084FC',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
