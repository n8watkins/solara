import { Lock, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { DayWeather } from '@/lib/types'
import { LOCKED_DAYS_UPSELL, dayChips, type DashboardAccess } from '@/lib/dashboard-view'
import { DayDialog } from '../deferred'

type Access = Pick<
  DashboardAccess,
  'visibleForecast' | 'selectedDay' | 'lockedForecastCount' | 'showDayTabs'
>

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-[5px] rounded-[10px] border-0 px-3.5 py-2 text-[13px] max-[359px]:px-2 font-semibold transition-all duration-[120ms] ${
        active ? 'bg-accent text-accent-on' : 'bg-surface-metric text-ink'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * The day picker, with no horizontal scroll: Today and Tomorrow are direct
 * chips, every later day is in a dialog behind "More days", and a plan with
 * locked days gets a locked "Next 10 days" tab that opens the Pro plans. The
 * refresh button always renders, so it stays reachable when only one day is
 * visible. Under 360 px the chips are a little narrower, so Today, Tomorrow and
 * More days still share one row with it.
 */
export default function DayPicker({
  access,
  onSelectDay,
  onRefresh,
  onUpgrade,
}: {
  access: Access
  onSelectDay: (day: DayWeather | null) => void
  onRefresh: () => void
  /** Opens the Pro plans from the locked tab. */
  onUpgrade: () => void
}) {
  const [open, setOpen] = useState(false)
  const chips = dayChips(access)
  const { tomorrow, more } = chips
  return (
    <div data-testid="day-picker" className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {access.showDayTabs && (
          <>
            <Chip label="Today" active={chips.todayActive} onClick={() => onSelectDay(null)} />
            {tomorrow && (
              <Chip
                label="Tomorrow"
                active={chips.tomorrowActive}
                onClick={() => onSelectDay(tomorrow)}
              />
            )}
            {more && <Chip label={more.label} active={more.active} onClick={() => setOpen(true)} />}
            {chips.lockedDays > 0 && (
              <button
                onClick={onUpgrade}
                aria-label={LOCKED_DAYS_UPSELL}
                title={LOCKED_DAYS_UPSELL}
                className="flex shrink-0 cursor-pointer items-center gap-[5px] rounded-[10px] border-[0.5px] border-dashed border-accent-border bg-transparent px-3.5 py-2 text-[13px] max-[359px]:px-2 font-semibold text-accent transition-all duration-[120ms]"
              >
                <Lock size={14} strokeWidth={2.25} /> Next 10 days
              </button>
            )}
          </>
        )}
      </div>
      <button
        className="btn btn-ghost shrink-0 px-[9px] py-[7px] text-[17px]"
        onClick={onRefresh}
        title="Refresh"
        aria-label="Refresh forecast"
      >
        <RotateCw size={17} />
      </button>

      {open && (
        <DayDialog
          access={access}
          onSelectDay={day => {
            onSelectDay(day)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
