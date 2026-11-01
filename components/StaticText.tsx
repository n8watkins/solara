// Text in a page's static HTML, shown before any script runs (the loading screen, the
// footer, pages without JavaScript): every language's version is in the HTML and CSS
// shows the page's language (app/globals.css, html[lang] from lib/i18n.ts), so it is
// right from the first frame and never changes on screen. Use it only for such text; the
// app's own text reads the live catalogue.
import type { Locale } from '@/lib/i18n'

export default function StaticText({ text }: { text: Readonly<Record<Locale, string>> }) {
  return (
    <>
      <span data-lang="en" lang="en">
        {text.en}
      </span>
      <span data-lang="es" lang="es">
        {text.es}
      </span>
    </>
  )
}
