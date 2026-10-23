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
      style={{
        padding: '0 4px',
        borderRadius: '4px',
        color: 'var(--text)',
        background: 'var(--bg-metric)',
        border: '1px dashed var(--border-md)',
      }}
    >
      [Placeholder: {LEGAL_PLACEHOLDER_LABELS[name]}]
    </mark>
  )
}
