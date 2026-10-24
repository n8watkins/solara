// Tailwind CSS 4 runs as a PostCSS plugin; Next.js (Turbopack) picks this file
// up for every stylesheet. Vendor prefixing is built in, so there is no
// autoprefixer. Theme and content configuration live in app/globals.css.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
