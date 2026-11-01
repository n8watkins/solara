'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import ActivityModalShell from './ActivityModalShell'
import GoogleSignInButton from './GoogleSignInButton'
import {
  proFeatures,
  PRO_PLAN,
  isCheckoutConfigured,
  createCheckoutUrl,
  type BillingPlan,
} from '@/lib/billing'
import { alertsLaunched } from '@/lib/plans'
import { isStoreBuild } from '@/lib/store-build'
import { TIER_LIMITS } from '@solara/core/tiers'
import m from '@/messages/pricing'

interface Props {
  /** The signed-in account; null or absent for a guest, who is offered sign-in first. */
  user?: User | null
  email?: string
  /** Called with the entered email when checkout isn't configured (waitlist fallback). */
  onJoinWaitlist?: (email: string) => void
  alreadyWaitlisted?: boolean
  onClose: () => void
  /** Overrides whether checkout is offered (the UI harness shows both states). */
  checkoutAvailable?: boolean
}

function Cell({ value }: { value: string | boolean }) {
  if (typeof value === 'string') return <span className="font-semibold text-ink">{value}</span>
  return (
    <>
      <span aria-hidden="true" className={value ? 'font-bold text-success' : 'text-ink-3'}>
        {value ? '✓' : '–'}
      </span>
      <span className="sr-only">{value ? m.included : m.notIncluded}</span>
    </>
  )
}

const HEADER_CELL = 'px-1.5 py-2.5 text-center text-[13px]'
const BODY_CELL =
  'border-t-[0.5px] border-line-strong py-[11px] text-[12px] leading-[1.3] font-normal'
/**
 * A plan's value: a long word ("Sincronizado" at 320 px) hyphenates, or breaks, inside its
 * narrow column instead of running into the next one. The row names, in the wider first
 * column, wrap between words only.
 */
const VALUE_CELL = 'hyphens-auto [overflow-wrap:anywhere]'
const NOTICE =
  'rounded-[10px] border-[0.5px] border-notice-border bg-notice px-3 py-2.5 text-[13px]'

type Column = 'guest' | 'free' | 'pro'
const COLUMN_NAMES: Record<Column, () => string> = {
  guest: () => m.columnGuest,
  free: () => m.columnFree,
  pro: () => m.columnPro,
}

interface PlanOption {
  plan: BillingPlan
  period: string
  price: string
  per: string
  badge?: string
}

// Read when drawn, in the page's language.
function planOptions(): PlanOption[] {
  return [
    { plan: 'monthly', period: m.monthly, price: PRO_PLAN.monthly, per: m.perMonth },
    {
      plan: 'yearly',
      period: m.yearly,
      price: PRO_PLAN.yearly,
      per: m.perYear,
      badge: m.savePercent(PRO_PLAN.yearlySavingPercent),
    },
  ]
}

function PriceCardBody({ period, price, per, badge }: PlanOption) {
  return (
    <>
      <span className="flex h-[22px] items-center justify-between gap-2 text-[12px] font-semibold text-ink-2">
        {period}
        {badge && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] leading-[16px] font-bold text-accent">
            {badge}
          </span>
        )}
      </span>
      <span className="text-ink">
        {/* "US$19.99" in Spanish fits the half-width card from 320 px (REVIEW10 QA L4). */}
        <span className="text-[clamp(15px,calc(9.4vw-15px),22px)] font-extrabold whitespace-nowrap">
          {price}
        </span>
        <span className="text-[13px] text-ink-3"> / {per}</span>
      </span>
    </>
  )
}

const CARD = 'metric-card flex flex-col gap-1 px-3.5 py-3'

/** One way to pay for Pro, as a card; a choice between the two once checkout is open. */
function PriceCard({
  option,
  selected,
  onSelect,
}: {
  option: PlanOption
  /** Absent while Pro is a waitlist: the card only shows the price. */
  selected?: boolean
  onSelect?: (plan: BillingPlan) => void
}) {
  if (!onSelect) {
    return (
      <p className={CARD}>
        <PriceCardBody {...option} />
      </p>
    )
  }
  return (
    <label
      className={clsx(
        CARD,
        'cursor-pointer ring-inset outline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
        selected ? 'ring-2 ring-accent' : 'ring-1 ring-transparent hover:ring-accent-border',
      )}
    >
      <input
        type="radio"
        name="pro-plan"
        value={option.plan}
        checked={selected}
        onChange={() => onSelect(option.plan)}
        className="sr-only"
      />
      <PriceCardBody {...option} />
    </label>
  )
}

/**
 * The plans dialog that every upsell opens. Pro is a waitlist until the owner
 * switches billing on (isCheckoutConfigured); then the account picks monthly or
 * yearly and starts the free trial in Stripe Checkout. A guest is offered free
 * sign-in first, since a subscription or the waitlist belongs to an account.
 *
 * An app store build (lib/store-build.ts) sells nothing: a guest sees only free sign-in
 * and what it adds, with no Pro column, price or waitlist, and a signed-in account sees
 * nothing (no Pro offer opens it there).
 */
export default function PricingModal({
  user,
  email,
  onJoinWaitlist,
  alreadyWaitlisted,
  onClose,
  checkoutAvailable,
}: Props) {
  const store = isStoreBuild()
  const checkoutReady = !store && (checkoutAvailable ?? isCheckoutConfigured())
  const guest = !user
  const [plan, setPlan] = useState<BillingPlan>('monthly')
  const [waitEmail, setWaitEmail] = useState(email ?? '')
  const [joined, setJoined] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const columns: Column[] = store
    ? ['guest', 'free']
    : guest
      ? ['guest', 'free', 'pro']
      : ['free', 'pro']
  // The store build compares only what free sign-in adds.
  const features = proFeatures()
  const rows = store ? features.filter(f => f.free !== false) : features
  const wide = columns.length === 3

  async function upgrade() {
    if (!user) return
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      const url = await createCheckoutUrl(user, plan)
      window.location.assign(url)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : m.checkoutUnavailable)
      setCheckoutLoading(false)
    }
  }

  function join() {
    onJoinWaitlist?.(waitEmail.trim())
    setJoined(true)
  }

  if (store && !guest) return null

  let footer
  if (store) {
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="min-w-45 flex-1 text-[13px] leading-[1.45] text-ink-2">
          {m.signInGoogleFree}
        </p>
        <GoogleSignInButton label={m.signInFree} preload />
      </div>
    )
  } else if (guest) {
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="min-w-45 flex-1 text-[13px] leading-[1.45] text-ink-2">
          {checkoutReady ? m.guestTrial : m.guestWaitlist}
        </p>
        <GoogleSignInButton label={m.signInFree} preload />
      </div>
    )
  } else if (checkoutReady) {
    const options = planOptions()
    const chosen = options.find(option => option.plan === plan) ?? options[0]!
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[20px] font-extrabold text-ink">
            {chosen.price} / {chosen.per}
          </p>
          <p className="text-[12px] text-ink-3">{m.afterTrial(PRO_PLAN.trialDays)}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary w-full justify-center px-5.5 py-2.5 text-[14px] sm:w-auto"
          onClick={() => void upgrade()}
          disabled={checkoutLoading}
        >
          {checkoutLoading ? m.openingCheckout : m.startTrial}
        </button>
      </div>
    )
  } else {
    footer = (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          autoComplete="email"
          aria-label={m.emailEarlyAccess}
          placeholder={m.emailEarlyAccess}
          value={waitEmail}
          onChange={e => setWaitEmail(e.target.value)}
          className="min-w-45 flex-1 text-[13px]"
        />
        <button
          type="button"
          className="btn btn-primary text-[13px] whitespace-nowrap"
          onClick={join}
          disabled={!waitEmail.trim()}
        >
          {joined || alreadyWaitlisted ? m.onWaitlist : m.joinWaitlist}
        </button>
      </div>
    )
  }

  return (
    <ActivityModalShell
      title={store ? m.signInFree : m.solaraPro}
      description={
        store
          ? m.storeLead(TIER_LIMITS.free.activities)
          : // Only what Pro adds: calendar export is Free too (REVIEW9 QA L7).
            alertsLaunched()
            ? m.proLead
            : m.proLeadSoon
      }
      onClose={onClose}
      footer={footer}
    >
      <div className="flex flex-col gap-3.5">
        {!checkoutReady && !store && (
          <div className={`${NOTICE} text-ink-2`}>{m.launchingSoon(PRO_PLAN.trialDays)}</div>
        )}
        {checkoutError && (
          <p role="alert" className="text-[13px] text-danger">
            {checkoutError}
          </p>
        )}

        {!store && (
          <div>
            {checkoutReady && !guest ? (
              <fieldset>
                <legend className="sr-only">{m.choosePay}</legend>
                <div className="grid grid-cols-2 gap-2.5">
                  {planOptions().map(option => (
                    <PriceCard
                      key={option.plan}
                      option={option}
                      selected={plan === option.plan}
                      onSelect={setPlan}
                    />
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {planOptions().map(option => (
                  <PriceCard key={option.plan} option={option} />
                ))}
              </div>
            )}
            <p className="mt-2 text-[12px] text-ink-3">
              {checkoutReady
                ? m.newSubscribers(PRO_PLAN.trialDays)
                : m.bothStartTrial(PRO_PLAN.trialDays)}
            </p>
          </div>
        )}

        <div className="metric-card overflow-hidden p-0">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              {store ? m.captionStore : guest ? m.captionGuest : m.captionFree}
            </caption>
            <colgroup>
              <col className={wide ? 'w-[31%]' : 'w-[40%]'} />
              {columns.map(column => (
                <col key={column} className={wide ? 'w-[23%]' : 'w-[30%]'} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <td className="px-3 py-2.5" />
                {columns.map(column => (
                  <th
                    key={column}
                    scope="col"
                    className={clsx(
                      HEADER_CELL,
                      column === 'pro' ? 'font-extrabold text-accent' : 'font-bold text-ink-2',
                    )}
                  >
                    {COLUMN_NAMES[column]()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.label}>
                  <th scope="row" className={`${BODY_CELL} px-3 text-left text-[13px] text-ink`}>
                    {f.label}
                  </th>
                  {columns.map(column => (
                    <td
                      key={column}
                      className={clsx(
                        BODY_CELL,
                        VALUE_CELL,
                        'px-1.5 text-center',
                        column === 'pro' && 'bg-accent-soft',
                      )}
                    >
                      <Cell value={f[column]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ActivityModalShell>
  )
}
