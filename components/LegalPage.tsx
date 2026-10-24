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
    <main className="min-h-screen bg-surface px-4 pt-8 pb-16">
      <article className="card mx-auto max-w-[760px] p-[clamp(20px,5vw,48px)]">
        <Link href="/" className="text-[14px] text-accent no-underline">
          ← Back to Solara
        </Link>
        <h1 className="mt-6 mb-1.5 text-[clamp(28px,6vw,42px)] leading-[1.1] font-[750]">
          {title}
        </h1>
        <p className="mb-8 text-[13px] text-ink-3">Last updated {updated}</p>
        <div className="legal-copy">{children}</div>
      </article>
    </main>
  )
}
