'use client'
// The account page's signed-in controls (components/account/AccountControls.tsx) with
// fixed fixtures, for tests/harness/account-controls.spec.ts.
//
// Query parameter `state`:
//   ready (default) | confirmed | deleting | failed | blocked | pro
import { useState } from 'react'
import AccountControls, { AccountPageFrame } from '@/components/account/AccountControls'
import type { BillingSummary } from '@/lib/billing'
import { HARNESS_MARKER } from './fixtures'

const FREE: BillingSummary = {
  pro: false,
  plan: null,
  status: null,
  trialEndsAt: null,
  periodEndsAt: null,
  cancelAtPeriodEnd: false,
  provider: 'stripe',
  hasBillingAccount: false,
}

const PRO: BillingSummary = {
  pro: true,
  plan: 'yearly',
  status: 'active',
  trialEndsAt: null,
  periodEndsAt: new Date('2027-06-15T12:00:00Z'),
  cancelAtPeriodEnd: false,
  provider: 'stripe',
  hasBillingAccount: true,
}

const STATES = ['ready', 'confirmed', 'deleting', 'failed', 'blocked', 'pro'] as const
type State = (typeof STATES)[number]

const MESSAGES: Partial<Record<State, string>> = {
  deleting: 'Deleting your data. Keep this page open.',
  failed:
    'Not all of your data could be deleted, so your account is still here. Check your connection and try again; deletion picks up where it stopped. If it keeps failing, email contact@n8builds.dev and we will delete your account and all its data within 30 days.',
}

export default function AccountHarness() {
  const [state] = useState<State>(() => {
    const value = new URLSearchParams(window.location.search).get('state')
    return STATES.find(s => s === value) ?? 'ready'
  })
  const [confirmation, setConfirmation] = useState(
    state === 'ready' || state === 'pro' ? '' : 'DELETE',
  )
  return (
    <div data-testid={HARNESS_MARKER}>
      <AccountPageFrame emailFallback>
        <AccountControls
          billing={state === 'pro' ? PRO : FREE}
          billingPortalReady={state === 'pro'}
          canDelete={state !== 'blocked'}
          busy={state === 'deleting' ? 'delete' : null}
          confirmation={confirmation}
          message={MESSAGES[state] ?? ''}
          onConfirmationChange={setConfirmation}
          onManageBilling={() => undefined}
          onDownload={() => undefined}
          onDelete={() => undefined}
        />
      </AccountPageFrame>
    </div>
  )
}
