import type { Locale } from '@solara/core/i18n'
import type { LegalDetail as LegalDetailKey } from '@/lib/legal'
import { LEGAL_DETAILS, LEGAL_DETAILS_TRANSLATED, LEGAL_PLACEHOLDER_LABELS } from '@/lib/legal'

/**
 * One operator detail from lib/legal.ts, in the page's language where it reads
 * differently, or a highlighted placeholder that makes the missing owner decision obvious
 * on the page.
 */
export default function LegalDetail({
  name,
  locale = 'en',
}: {
  name: LegalDetailKey
  locale?: Locale
}) {
  const value =
    LEGAL_DETAILS[name] && (LEGAL_DETAILS_TRANSLATED[locale]?.[name] ?? LEGAL_DETAILS[name])
  if (value) {
    return name === 'contactEmail' ? <a href={`mailto:${value}`}>{value}</a> : <>{value}</>
  }
  return (
    <mark
      data-legal-placeholder={name}
      className="rounded-sm border border-dashed border-line-strong bg-surface-metric px-1 text-ink"
    >
      [Placeholder: {LEGAL_PLACEHOLDER_LABELS[name]}]
    </mark>
  )
}
