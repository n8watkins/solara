import Link from 'next/link'
import type { ReactNode } from 'react'

export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px 64px' }}>
      <article
        className="card"
        style={{ maxWidth: '760px', margin: '0 auto', padding: 'clamp(20px, 5vw, 48px)' }}
      >
        <Link href="/" style={{ color: 'var(--accent)', fontSize: '14px', textDecoration: 'none' }}>
          ← Back to Solara
        </Link>
        <h1
          style={{
            margin: '24px 0 6px',
            fontSize: 'clamp(28px, 6vw, 42px)',
            fontWeight: 750,
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        <p style={{ margin: '0 0 32px', color: 'var(--text-3)', fontSize: '13px' }}>
          Last updated {updated}
        </p>
        <div className="legal-copy">{children}</div>
      </article>
    </main>
  )
}
