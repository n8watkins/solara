/**
 * Operator details shown in the privacy policy and terms (owner decision D8 in
 * docs/assessment-2026-10/PLAN.md). A null value renders a clearly marked
 * placeholder instead.
 */
export const LEGAL_DETAILS: Readonly<{
  /** Legal name of the person or company that runs Solara. */
  operatorName: string | null
  /** Address for privacy requests and questions. */
  contactEmail: string | null
  /** Country or state whose law governs the terms, e.g. "California, United States". */
  jurisdiction: string | null
  /** License for Solara's own source code, e.g. "MIT" or "All rights reserved". */
  codeLicense: string | null
}> = {
  operatorName: 'Nathan Watkins',
  contactEmail: 'contact@n8builds.dev',
  jurisdiction: 'California, United States',
  codeLicense: 'All rights reserved',
}

export const LEGAL_LAST_UPDATED = 'October 23, 2026'

export type LegalDetail = keyof typeof LEGAL_DETAILS

export const LEGAL_PLACEHOLDER_LABELS: Readonly<Record<LegalDetail, string>> = {
  operatorName: 'operator name',
  contactEmail: 'contact email',
  jurisdiction: 'governing jurisdiction',
  codeLicense: 'source code license',
}
