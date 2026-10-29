// The signed-in part of the account page (app/account/page.tsx): plan and billing, the
// data download and account deletion. It only shows state and reports clicks; the page
// does the work, through the Functions or in this browser (lib/account-data.ts
// accountControlsPath). The UI harness renders it with fixtures (app/harness/account).
import Link from 'next/link'
import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import { APP_PATH } from '@/lib/app-routes'
import { billingStatusText, type BillingSummary } from '@/lib/billing'
import { isStoreBuild } from '@/lib/store-build'
import { ChevronDown } from 'lucide-react'
import {
  DATA_REQUEST_DAYS,
  DATA_REQUEST_EMAIL,
  DELETION_SUMMARY,
  EXPORT_EXCLUDED,
  EXPORT_SUMMARY,
  buildAccountFeatures,
  capitalized,
  deletedDataShown,
  deletionNotesShown,
  exportSectionsShown,
} from '@/lib/account-data'

export type AccountBusy = 'billing' | 'export' | 'delete' | null

export interface AccountControlsProps {
  /** The subscription as the server last recorded it; undefined while it loads. */
  billing: BillingSummary | null | undefined
  /** Whether the billing portal can be opened from this build (Functions). */
  billingPortalReady: boolean
  /**
   * Whether this page can delete the account: true, false when only the server can (the
   * page then offers email), or undefined while that is being checked.
   */
  canDelete: boolean | undefined
  busy: AccountBusy
  confirmation: string
  /** The result of the last action, read out as a status. */
  message: string
  onConfirmationChange: (value: string) => void
  onManageBilling: () => void
  onDownload: () => void
  onDelete: () => void
}

export default function AccountControls({
  billing,
  billingPortalReady,
  canDelete,
  busy,
  confirmation,
  message,
  onConfirmationChange,
  onManageBilling,
  onDownload,
  onDelete,
}: AccountControlsProps) {
  const hintId = useId()
  // The Stripe portal sells plan changes, so an app store build never offers it.
  const portal = !!billing?.hasBillingAccount && !isStoreBuild()
  // The lists name only what this build can hold (REVIEW9 QA L6).
  const features = buildAccountFeatures()
  return (
    <>
      <div className="grid gap-[18px]">
        <AccountSection
          title="Plan and billing"
          note={
            portal
              ? 'Change plans, update your payment method, see invoices or cancel securely through Stripe.'
              : undefined
          }
          body={
            billing === undefined
              ? 'Loading your plan...'
              : billing === null
                ? 'Your plan could not be loaded. Check your connection and reload.'
                : billingStatusText(billing, formatDay, { store: isStoreBuild() })
          }
        >
          {portal ? (
            <button
              className="btn btn-primary"
              disabled={busy !== null || !billingPortalReady}
              onClick={onManageBilling}
            >
              {busy === 'billing' ? 'Opening...' : 'Manage subscription'}
            </button>
          ) : null}
        </AccountSection>

        <AccountSection
          title="Download your data"
          body={EXPORT_SUMMARY}
          details={
            <Disclosure summary="What's included">
              <DetailList items={exportSectionsShown(features)} />
              <p className="mt-2">{EXPORT_EXCLUDED}</p>
            </Disclosure>
          }
        >
          <button className="btn btn-primary" disabled={busy !== null} onClick={onDownload}>
            {busy === 'export' ? 'Preparing...' : 'Download account data'}
          </button>
        </AccountSection>

        <AccountSection
          danger
          title="Delete account"
          body={DELETION_SUMMARY}
          details={
            <Disclosure summary="What's deleted, and what stays">
              <p className="mb-1 font-semibold text-ink-2">Deleted from Solara</p>
              <DetailList items={deletedDataShown(features)} />
              <p className="mt-2.5 mb-1 font-semibold text-ink-2">Outside Solara</p>
              <DetailList items={deletionNotesShown(features)} />
            </Disclosure>
          }
        >
          {canDelete === false ? (
            <p className="rounded-[10px] border-[0.5px] border-notice-border bg-notice p-3 text-[14px] leading-[1.55] text-notice-ink">
              Part of this account can only be removed by Solara&apos;s servers, which are not
              running yet. To delete it, email <EmailLink /> and we will delete your account and all
              its data within {DATA_REQUEST_DAYS} days.
            </p>
          ) : (
            <>
              <label className="mb-2 block text-[13px] font-semibold" htmlFor="delete-confirmation">
                Type DELETE to confirm
              </label>
              <div className="flex flex-wrap gap-2.5">
                <input
                  id="delete-confirmation"
                  value={confirmation}
                  onChange={event => onConfirmationChange(event.target.value)}
                  autoComplete="off"
                  aria-describedby={hintId}
                  className="min-w-0 grow basis-[200px] sm:grow-0 sm:basis-[236px]"
                />
                <button
                  className="btn border-danger/40 text-danger"
                  disabled={confirmation !== 'DELETE' || busy !== null || canDelete !== true}
                  onClick={onDelete}
                >
                  {busy === 'delete' ? 'Deleting...' : 'Delete permanently'}
                </button>
              </div>
              <p id={hintId} className="mt-2.5 text-[13px] leading-[1.55] text-ink-3">
                Google then asks you to sign in again, to confirm it is you.
              </p>
            </>
          )}
        </AccountSection>
      </div>

      {message && (
        <p role="status" className="mt-[18px] leading-[1.55] text-ink-2">
          {message}
        </p>
      )}
    </>
  )
}

/**
 * The account page around its content: the way back, the title, and the email way out
 * (`emailFallback`) for anyone the page cannot help.
 */
export function AccountPageFrame({
  emailFallback,
  children,
}: {
  emailFallback: boolean
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-surface px-4 pt-8 pb-16">
      <div className="mx-auto max-w-[680px]">
        <Link href={APP_PATH} className="text-[14px] text-accent no-underline">
          ← Back to Solara
        </Link>
        <h1 className="mt-6 mb-2 text-[clamp(28px,6vw,42px)] leading-[1.1] font-[750]">
          Account controls
        </h1>
        <p className="mb-7 leading-[1.6] text-ink-2">
          Manage your plan, download your data or delete your account.
        </p>
        {children}
        {emailFallback && (
          <p className="mt-[18px] text-[13px] leading-[1.55] text-ink-3">
            Something not working? Email <EmailLink /> and we will send you your data or delete your
            account within {DATA_REQUEST_DAYS} days.
          </p>
        )}
        <p className="mt-[30px] text-[13px] text-ink-3">
          Review the{' '}
          <Link href="/privacy/" className="underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/terms/" className="underline">
            Terms of Use
          </Link>
          .
        </p>
      </div>
    </main>
  )
}

function EmailLink() {
  return (
    <a href={`mailto:${DATA_REQUEST_EMAIL}`} className="underline">
      {DATA_REQUEST_EMAIL}
    </a>
  )
}

/** A date as "Nov 3, 2026" in the reader's locale. */
function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The details behind a section's lead sentence, closed until asked for, so a phone
 * shows the controls instead of a wall of text.
 */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-1.5 text-[13px] leading-[1.55] text-ink-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md font-semibold text-accent [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

function DetailList({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 list-disc space-y-0.5 pl-[18px]">
      {items.map(item => (
        <li key={item}>{capitalized(item)}</li>
      ))}
    </ul>
  )
}

function AccountSection({
  title,
  body,
  note,
  details,
  danger = false,
  children,
}: {
  title: string
  body: string
  /** A smaller second line under the body. */
  note?: string
  /** A disclosure with the details behind the body (components below). */
  details?: ReactNode
  danger?: boolean
  children?: ReactNode
}) {
  const gap = !children ? 'mb-0' : danger ? 'mb-3.5' : 'mb-[18px]'
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={clsx('card', danger && 'border-danger/40')}>
      <h2 id={headingId} className={clsx('mb-2 text-[18px] font-[650]', danger && 'text-danger')}>
        {title}
      </h2>
      <p className={clsx('leading-[1.55] text-ink-2', note || details ? 'mb-1.5' : gap)}>{body}</p>
      {note && (
        <p className={clsx('text-[13px] leading-[1.55] text-ink-3', !details && gap)}>{note}</p>
      )}
      {details && <div className={gap}>{details}</div>}
      {children}
    </section>
  )
}
