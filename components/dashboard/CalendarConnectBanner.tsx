import { CalendarDays } from 'lucide-react'
import type { CalendarBusyStatus } from '@/hooks/useCalendarBusy'
import m from '@/messages/activities'

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
      <CalendarDays size={17} className="shrink-0 text-ink-3" />
      {status === 'connected' ? (
        <p className="flex-1 text-[13px] text-ink-2">
          {m.calendarConnected} <span className="text-ink-3">{m.calendarPrivacy}</span>
        </p>
      ) : (
        <>
          <p className="flex-1 text-[13px] text-ink-2">
            {m.connectPrompt}
            {status === 'error' && <span className="text-danger"> {m.couldNotConnect}</span>}
          </p>
          <button
            className="btn shrink-0 text-[12px] whitespace-nowrap"
            onClick={onConnect}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? m.connecting : m.connectCalendar}
          </button>
        </>
      )}
    </div>
  )
}
