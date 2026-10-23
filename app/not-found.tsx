import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Page not found | Solara',
  robots: { index: false, follow: false },
}

// Exported as out/404.html, which Firebase Hosting serves with a 404 status for
// any path that has no page.
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: '480px', textAlign: 'center', padding: '32px 26px' }}
      >
        <p style={{ fontSize: '42px', margin: '0 0 12px' }} aria-hidden="true">
          🌤️
        </p>
        <h1 style={{ margin: '0 0 10px', fontSize: '26px', fontWeight: 750, color: 'var(--text)' }}>
          Page not found
        </h1>
        <p
          style={{ margin: '0 0 22px', fontSize: '15px', color: 'var(--text-2)', lineHeight: 1.55 }}
        >
          This address doesn&apos;t match anything in Solara. Check the link, or head back to your
          forecast.
        </p>
        <Link
          href="/"
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            textDecoration: 'none',
            justifyContent: 'center',
            padding: '11px 18px',
          }}
        >
          Open Solara
        </Link>
      </div>
    </main>
  )
}
