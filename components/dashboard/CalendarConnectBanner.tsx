import type { CalendarBusyStatus } from '@/hooks/useCalendarBusy'

/** Offers to schedule recommendations around Google Calendar free/busy. */
export default function CalendarConnectBanner({
  status,
  onConnect,
}: {
  status: CalendarBusyStatus
  onConnect: () => void
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-metric px-3 py-2.5">
      <span className="shrink-0 text-[16px]">🗓️</span>
      {status === 'connected' ? (
        <p className="flex-1 text-[13px] text-ink-2">
          Recommendations now schedule around your calendar.{' '}
          <span className="text-ink-3">
            Solara sees only when you&apos;re busy, never event details.
          </span>
        </p>
      ) : (
        <>
          <p className="flex-1 text-[13px] text-ink-2">
            Connect Google Calendar to schedule activities around your real availability.
            {status === 'error' && (
              <span className="text-danger"> Couldn&apos;t connect. Try again.</span>
            )}
          </p>
          <button
            className="btn shrink-0 text-[12px] whitespace-nowrap"
            onClick={onConnect}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect calendar'}
          </button>
        </>
      )}
    </div>
  )
}
