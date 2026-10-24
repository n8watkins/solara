import type { LegalDetail as LegalDetailKey } from '@/lib/legal'
import { LEGAL_DETAILS, LEGAL_PLACEHOLDER_LABELS } from '@/lib/legal'

/**
 * One operator detail from lib/legal.ts, or a highlighted placeholder that
 * makes the missing owner decision obvious on the page.
 */
export default function LegalDetail({ name }: { name: LegalDetailKey }) {
  const value = LEGAL_DETAILS[name]
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
