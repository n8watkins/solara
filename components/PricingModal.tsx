'use client'
import { useState } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import ActivityModalShell from './ActivityModalShell'
import GoogleSignInButton from './GoogleSignInButton'
import {
  PRO_FEATURES,
  PRO_PLAN,
  isCheckoutConfigured,
  createCheckoutUrl,
  type BillingPlan,
} from '@/lib/billing'

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
      <span className="sr-only">{value ? 'Included' : 'Not included'}</span>
    </>
  )
}

const HEADER_CELL = 'px-1.5 py-2.5 text-center text-[13px]'
const BODY_CELL =
  'border-t-[0.5px] border-line-strong py-[11px] text-[12px] leading-[1.3] font-normal'
const NOTICE =
  'rounded-[10px] border-[0.5px] border-notice-border bg-notice px-3 py-2.5 text-[13px]'

type Column = 'guest' | 'free' | 'pro'
const COLUMN_NAMES: Record<Column, string> = { guest: 'Guest', free: 'Free', pro: 'Pro' }

interface PlanOption {
  plan: BillingPlan
  period: string
  price: string
  per: string
  badge?: string
}

const PLAN_OPTIONS: PlanOption[] = [
  { plan: 'monthly', period: 'Monthly', price: PRO_PLAN.monthly, per: 'month' },
  {
    plan: 'yearly',
    period: 'Yearly',
    price: PRO_PLAN.yearly,
    per: 'year',
    badge: `Save ${PRO_PLAN.yearlySavingPercent}%`,
  },
]

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
        <span className="text-[22px] font-extrabold">{price}</span>
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
 */
export default function PricingModal({
  user,
  email,
  onJoinWaitlist,
  alreadyWaitlisted,
  onClose,
  checkoutAvailable,
}: Props) {
  const checkoutReady = checkoutAvailable ?? isCheckoutConfigured()
  const guest = !user
  const [plan, setPlan] = useState<BillingPlan>('monthly')
  const [waitEmail, setWaitEmail] = useState(email ?? '')
  const [joined, setJoined] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const columns: Column[] = guest ? ['guest', 'free', 'pro'] : ['free', 'pro']

  async function upgrade() {
    if (!user) return
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      const url = await createCheckoutUrl(user, plan)
      window.location.assign(url)
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : 'Checkout is temporarily unavailable',
      )
      setCheckoutLoading(false)
    }
  }

  function join() {
    onJoinWaitlist?.(waitEmail.trim())
    setJoined(true)
  }

  let footer
  if (guest) {
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="min-w-45 flex-1 text-[13px] leading-[1.45] text-ink-2">
          {checkoutReady
            ? 'Sign in free to save your plan, see tomorrow and start a Pro trial.'
            : 'Sign in free to save your plan, see tomorrow and join the Pro waitlist.'}
        </p>
        <GoogleSignInButton label="Sign in free" preload />
      </div>
    )
  } else if (checkoutReady) {
    const chosen = PLAN_OPTIONS.find(option => option.plan === plan) ?? PLAN_OPTIONS[0]!
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[20px] font-extrabold text-ink">
            {chosen.price} / {chosen.per}
          </p>
          <p className="text-[12px] text-ink-3">
            After the {PRO_PLAN.trialDays}-day free trial. Cancel anytime.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary w-full justify-center px-5.5 py-2.5 text-[14px] sm:w-auto"
          onClick={() => void upgrade()}
          disabled={checkoutLoading}
        >
          {checkoutLoading ? 'Opening checkout...' : 'Start free trial'}
        </button>
      </div>
    )
  } else {
    footer = (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          autoComplete="email"
          aria-label="Email for early access"
          placeholder="Email for early access"
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
          {joined || alreadyWaitlisted ? '✓ On the waitlist' : 'Join Pro waitlist'}
        </button>
      </div>
    )
  }

  return (
    <ActivityModalShell
      title="Solara Pro"
      description="10 days of planning, up to 20 activities, calendar sync, family profiles and morning alerts."
      onClose={onClose}
      footer={footer}
    >
      <div className="flex flex-col gap-3.5">
        {!checkoutReady && (
          <div className={`${NOTICE} text-ink-2`}>
            Pro is launching soon. Join the waitlist to be first in line for the{' '}
            {PRO_PLAN.trialDays}-day free trial.
          </div>
        )}
        {checkoutError && (
          <p role="alert" className="text-[13px] text-danger">
            {checkoutError}
          </p>
        )}

        <div>
          {checkoutReady && !guest ? (
            <fieldset>
              <legend className="sr-only">Choose how to pay</legend>
              <div className="grid grid-cols-2 gap-2.5">
                {PLAN_OPTIONS.map(option => (
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
              {PLAN_OPTIONS.map(option => (
                <PriceCard key={option.plan} option={option} />
              ))}
            </div>
          )}
          <p className="mt-2 text-[12px] text-ink-3">
            {checkoutReady
              ? `New subscribers start with a ${PRO_PLAN.trialDays}-day free trial. Stripe asks for a card and charges nothing until it ends.`
              : `Both start with a ${PRO_PLAN.trialDays}-day free trial. Cancel anytime.`}
          </p>
        </div>

        <div className="metric-card overflow-hidden p-0">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              {guest ? 'Guest, Free and Pro plan features' : 'Free and Pro plan features'}
            </caption>
            <colgroup>
              <col className={guest ? 'w-[31%]' : 'w-[40%]'} />
              {columns.map(column => (
                <col key={column} className={guest ? 'w-[23%]' : 'w-[30%]'} />
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
                    {COLUMN_NAMES[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRO_FEATURES.map(f => (
                <tr key={f.label}>
                  <th scope="row" className={`${BODY_CELL} px-3 text-left text-[13px] text-ink`}>
                    {f.label}
                  </th>
                  {columns.map(column => (
                    <td
                      key={column}
                      className={clsx(
                        BODY_CELL,
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
